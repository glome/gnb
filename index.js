/**
 * Simple message broker that sits between a Redis server and the web clients
 * connecting via websockets.
 *
 * Envrironment variables that can be used:
 *
 * o GNB_PORT: the port where this app is listening (default: 8082)
 * o REDIS_URL: Glome's Redis server to connect to
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
 * Copyright (c) 2014-2015 Glome Oy
 *
 */

var sockets = {};
var numUsers = 0;

//var debug = require('debug');
var path = require('path');
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server);
var port = process.env.GNB_PORT || 8082;

// Glome Redis connection
var redis = require("redis");
var redis_url = process.env.REDIS_URL;
var redis_options = {};

var glome_downstream = "glome:gnb:downstream";
var glome_upstream = "glome:gnb:upstream";

var glome_uplink = redis.createClient(redis_url, redis_options);
var glome_downlink = redis.createClient(redis_url, redis_options);

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

// Connect to Redis to receive message from Glome API server
glome_downlink.subscribe(glome_downstream);

/**
 * Message received via redis is dispatched here.
 *
 * A message can be:
 *
 *  o data to a specific user
 *  o broadcast to all users of the same app (same room) or
 *  o direct message to a specific user
 *  o notification to a specific user
 *
 * Message format specification
 *
 * Data messages:
 *
 *   uid:data:{token}:[invite]:{JSON object}
 *
 * Broadcast messages:
 *
 *   uid:message:broadcast:content
 *
 * Direct text messages
 *
 *   uid:message:{token}:content
 *
 * Notification messages:
 *
 *   uid:notification:{token}:notification:[paired|unpaired|locked|unlocked|brother|unbrother|erased]
 *
 */
glome_downlink.on("message", function (channel, message) {
  if (message == "config") {
    // TODO: future
  } else {
    //console.log('channel: ' + channel + ', message: ' + message);

    if (config.separator) {
      // parse the message and decide what to do
      var splits = message.split(config.separator);
      var uid = splits[0];
      var type = splits[1];
      var token = splits[2];
      var content = splits[3];
      var payload = '';

      if (typeof splits[4] != 'undefined')
      {
        payload = splits[4];
      }

      console.log('uid: ' + uid + ', type: ' + type + ', token: ' + token);
      console.log('content: ' + content + ', payload: ' + payload);

      switch (type) {
        case config.data_label:
          (payload != '') ? content += ':' + payload : content = content;
          send("gnb:data", uid, token, content);
          break;
        case config.message_label:
          if (token == config.broadcast_label) {
            io.sockets.in(uid).emit("gnb:broadcast", content);
            console.log('broadcast to: ' + uid + ', content: ' + content);
          } else {
            send("gnb:message", uid, token, content);
          }
          break;
        case config.notification_label:
          send("gnb:notification", uid, token, content);
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
  // uid is the Glome app's UID
  // token unique ID of the Glome user
  socket.on('gnb:connect', function (uid, token) {
    // the user joins to uid room automatically
    socket.join(uid, function() {
      if (typeof token != 'undefined')
      {
        socket.username = token;
        socket.appid = uid;

        if (typeof sockets[token] == 'undefined')
        {
          sockets[token] = [];
        }

        sockets[token].push(socket.id);

        var lastsid = sockets[token][sockets[token].length - 1];
        socket.emit('gnb:connected', {});

        // tell Glome that a user is connected
        var data = {
          action: 'connect',
          params: {
            socket: socket.id,
            token: token,
            uid: uid,
            sessions: sockets[socket.username].length
          },
        }
        var enc = new Buffer(JSON.stringify(data)).toString('base64');
        glome_uplink.publish(glome_upstream, enc);
        data = null;

        console.log('new client of ' + socket.username + ', sid: ' + lastsid);
        ++numUsers;
      }
      else
      {
        console.log('invalid typeof token: ' + typeof token + ': ' + token);
      }
    });
  });

  // when the client disconnects
  socket.on('disconnect', function () {
    // remove the connection from the global list
    if (typeof sockets[socket.username] !== 'undefined') {
      var index = sockets[socket.username].lastIndexOf(socket.id)
      if (index > -1)
      {
        console.log('disconnect from sockets of ' + socket.username);
        console.log(sockets[socket.username]);

        sockets[socket.username].splice(index, 1);
        socket.emit('gnb:disconnected', {});
        // tell Glome that a user is disconnected
        // this info should be submitted to 3rd part servers too
        var data = {
          action: 'disconnect',
          params: {
            socket: socket.id,
            token: socket.username,
            uid: socket.appid,
            sessions: sockets[socket.username].length
          }
        }
        var enc = new Buffer(JSON.stringify(data)).toString('base64');
        glome_uplink.publish(glome_upstream, enc);
        data = null;

        console.log('client gone: ' + socket.username + ', sid: ' + socket.id);
        --numUsers;
      }
      else
      {
        console.log('No socket available for ' + socket.username + ' with id: ' + socket.id);
      }
    }
  });
});

/**
 * Message sending
 */
function send(label, uid, token, content)
{
  if (typeof sockets[token] != 'undefined' && sockets[token].length > 0)
  {
    console.log('common send to all sockets of ' + token);
    console.log(sockets[token]);

    // send to each and every socket
    sockets[token].forEach(function(socket, index, array) {
      io.sockets.to(socket).emit(label, content);
      console.log('sent to ' + socket);
    });
  }
  else
  {
    console.log('No sockets available for ' + token);
  }
}
