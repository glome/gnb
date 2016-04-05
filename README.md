## Glome Notification Broker (GNB)

GNB is a simple message broker written in Node.js. It sits between Glome's Redis
server and the web clients connecting via websockets (or HTTP).

GNB establishes two connections to the Redis server for duplex communication.

One of the connections is the __downlink__ that carries messages from Glome
towards the clients.

The other connection is the __uplink__ that transfers messages from the
clients towards Glome.

### Installation

```bash
  $ npm install
```

This command will download the dependcies into the node_modules directory.

### Start

```bash
  $ node index.js
```

This command will start the broker with default configuration, ie. listening on
port 8082.

### Configuration

The following envrironment variables can be used to configure the broker:

 * <i>GNB_PORT</i>

    The port where GNB is listening for incoming requests (default: 8082).

 * <i>REDIS_URL</i>

    URL of Glome's Redis server to connect to.

### Redis channels

 * <i>glome:{uid}</i>

    For downlink where {uid} identifies the 3rd party Glome service. The {uid}
    is allocated when requesting [Glome API access](https://devland.glome.me).

 * <i>glome:app</i>

    For uplink purposes (when the client sends messages to Glome).

### Client events

 The following events can be emitted by the clients:

 * <i>gnb:connect</i>

    A service wants its user to get connected to GNB.

 * <i>gnb:disconnect</i>

    A service wants its user to be disconnected from GNB.

### GNB events

 These are the events that are emitted by GNB so that the clients can listen
 to them:

 * <i>gnb:connected</i>

    The client has succesfully connected to GNB.

 * <i>gnb:broadcast</i>

    Glome sends a broadcast to all users of a service.

 * <i>gnb:message</i>

    Glome sends a direct message to a specific user of a service.

 * <i>gnb:notification</i>

    Glome sends a direct message to a specific client. It is meant only for
    machine to machine communication.

### Firewall and web server setup

 * Make sure the node app port is only available from localhost


```bash
    # iptables -A INPUT -i lo -p tcp --dport 8082 -j ACCEPT
    # iptables -A INPUT -p tcp --dport 8082 -j DROP
```

 * Proxy SSL requests with Apache 2.4

```config
    <VirtualHost some.site.name:443>

      ServerName some.site.name

      SSLEngine on
      SSLCertificateFile /etc/ssl/certs/some.site.name.crt
      SSLCertificateKeyFile /etc/ssl/private/some.site.name.pem

      <Proxy *>
        Require host localhost
      </Proxy>

      Define gnb localhost:8082/

      RewriteEngine On
      RewriteCond %{REQUEST_URI}  ^/socket.io                 [NC]
      RewriteCond %{QUERY_STRING} transport=websocket         [NC]
      RewriteRule /(.*)           ws://${gnb}/$1              [P,L]

      ProxyPreserveHost On
      ProxyPass / http://${gnb}
      ProxyPassReverse / http://${gnb}

      DocumentRoot {the_location_of_gnb}

      LogLevel info
      # cronolog is great!
      ErrorLog "||/usr/bin/cronolog -S /var/log/apache2/current_some.site.name_https_error /var/log/apache2/%Y/%m/%d/some.site.name_https_error.log"
      CustomLog "||/usr/bin/cronolog -S /var/log/apache2/current_some.site.name_https_transfer /var/log/apache2/%Y/%m/%d/some.site.name_https_access.log" common
    </VirtualHost>
```

  * Proxy request with Nginx 1.4+

    TODO

### Licensing

Author: ferenc at glome dot me

License: MIT

Copyright (c) 2014 Glome Inc
