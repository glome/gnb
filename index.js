/**
 * Simple message broker that sits between a Redis server and the web clients
 * connecting via websockets.
 *
 * Envrironment variables that can be used:
 *
 * o GNB_PORT: the port where this app is listening (default: 8082)
 * o GLOME_REDIS_HOST: Host name of Glome's Redis server to connect to (default: localhost)
 * o GLOME_REDIS_PORT: Port of Glome's Redis server (default: 6379)
 *
 * The broker establishes two Redis connections for duplex communication.
 * One channel is the downlink that carries messages from Glome towards the
 * clients. The other connection is the uplink that transfers messages from the
 * clients towards Glome.
 *
 * Redis channels used:
 *
 * o downlink: glome:{uid} where {uid} identifies the 3rd part Glome service
 * o uplink: glome:app
 *
 * Events emitted by the client:
 *
 * o gnb:connect: a service wants its user to get connected to GNB
 * o gnb:disconnect: a service wants its user to be disconnected from GNB
 *
 * Events emitted by GNB:
 *
 * o gnb:connected: the client has succesfully connected to GNB
 * o gnb:broadcast: Glome sends a broadcast to all users of a service
 * o gnb:message: Glome sends a direct message to a specific user of a service
 * o gnb:notification: Glome sends a direct message to a specific client app,
 *                     meant only for machine to machine communication.
 *
 *
 * Author: ferenc at glome dot me
 * License: MIT
 * Copyright (c) 2014 Glome Oy
 *
 */

var users = {};
var numUsers = 0;

var debug = require('debug');
var path = require('path');
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.GNB_PORT || 8082;

// Glome Redis connection
var redis = require("redis");
var redis_port = process.env.GLOME_REDIS_PORT || 6379;
var redis_host = process.env.GLOME_REDIS_HOST || "localhost";
var redis_options = {};

var redis_queue_id = "glome:gnb";

var glome_uplink = redis.createClient(redis_port, redis_host, redis_options);
var glome_downlink = redis.createClient(redis_port, redis_host, redis_options);

// configuration that is received upon subscription
var config = {
  separator: ':',
  data_label: 'data',
  message_label: 'message',
  broadcast_label: 'broadcast',
  notification_label: 'notification',
};

server.listen(port, function () {
  console.log('Server listening at port %d', port);
});

// Simple routing
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname + '/public/welcome.html'));
});

// Connect to Redis
glome_downlink.subscribe(redis_queue_id);

/**
 * Message received via redis is dispatched here.
 *
 * A message can be:
 *
 *  o data to a specific user (glome ID)
 *  o broadcast to all users of the same app (same room) or
 *  o direct message to a specific user (glome ID)
 *  o notification to a specific user (glome ID)
 *
 * Message format specification
 *
 * Data messages:
 *
 *   uid:data:{glomeid}:[invite]:{JSON object}
 *
 * Broadcast messages:
 *
 *   uid:message:broadcast:content
 *
 * Direct text messages
 *
 *   uid:message:{glomeid}:content
 *
 * Notification messages:
 *
 *   uid:notification:{glomeid}:notification:[paired|unpaired|locked|unlocked|brother|unbrother|erased]
 *
 */
glome_downlink.on("message", function (channel, message) {
  if (message == "config") {
    // TODO: future
  } else {
    console.log('channel: ' + channel + ', message: ' + message);

    if (config.separator) {
      // parse the message and decide what to do
      var splits = message.split(config.separator);
      var uid = splits[0];
      var type = splits[1];
      var glomeid = splits[2];
      var content = splits[3];
      var payload = splits[4] || '';

      switch (type) {
        case config.data_label:
          (payload != '') ? content += ':' + payload : 1=1;
          io.sockets.to(users[glomeid].sid).emit("gnb:data", content);
          console.log('data to: ' + uid + ':' + glomeid + ', content: ' + content);
          break;
        case config.message_label:
          if (glomeid == config.broadcast_label) {
            io.sockets.in(uid).emit("gnb:broadcast", content);
            console.log('broadcast to: ' + uid + ', content: ' + content);
          } else {
            io.sockets.to(users[glomeid].sid).emit("gnb:message", content);
            console.log('message to: ' + uid + ':' + glomeid + ', content: ' + content);
          }
          break;
        case config.notification_label:
          io.sockets.to(users[glomeid].sid).emit("gnb:notification", content);
          console.log('notification to: ' + uid + ':' + glomeid + ', content: ' + content);
          break;
      }
    }
  }
});

/**
 * Register callbacks
 */
io.on('connection', function (socket) {
  // when the client connects
  socket.on('gnb:connect', function (uid, glomeid) {
    console.log('connecting: ' + glomeid + ', sid: ' + socket.id);

    // add the client's Glome ID to the global list
    users[glomeid] = {
      glomeid: glomeid,
      sid: socket.id
    }

    // the user joins to uid room automatically
    socket.join(uid, function() {
      ++numUsers;

      console.log(glomeid + ' joined room: ' + uid);
      socket.emit('gnb:connected', {});

      // tell Glome that a user is connected
      var data = {
        uid: uid,
        action: 'connected',
        glomeid: glomeid
      }
      glome_uplink.publish("glome:app", JSON.stringify(data));
    });
  });

  // when the client disconnects
  socket.on('gnb:disconnect', function () {
    // remove the Glome ID from global usernames list
    if (typeof users[socket.glomeid] !== 'undefined') {
      --numUsers;
      delete users[socket.glomeid];

      // tell Glome that a user is connected
      var data = {
        uid: uid,
        action: 'disconnected',
        glomeid: glomeid
      }
      glome_uplink.publish("glome:app", JSON.stringify(data));
    }
  });
});
