Blockd
=============
A simple distributed lock server in Node.js

What is It?
-------------
Need to coordinate resources between multiple applications, but instances running on different servers? Don't like complicated APIs? Have a more than passing affinity for Dolph Lundgren?

Blockd allows multiple clients to acquire and release "locks", just simple string identifiers, using a simple asynchronous API. It supports variable timeout and reader-writer locking.

Blockd was created by Flex Rental Solutions to manage real-time availability of documents in our system across multiple instances of a Java app. We needed a simple solution.

As of this writing, Blockd features client libraries in both Node.js and Java.

Why Node?
-------------
When tracking through SQL and memcache didn't work, we turned to Node.Js. Its simple TCP support made it easy to prototype. The single-threaded event loop model meant blockd could forego using locks internally.

Protocol
-------------
Blockd uses a simple JSON protocol, with an ability to take in simple space-delimited input for command-line testing.

A Simple Example
-------------
This example allows the user to quickly and easily try out the system without using a client and just using the command-line.

To run blockd, install Node, open a command-line, navigate to the blockd directory, and run the following command:

```
node blockd.js
```

This will start the blockd node. It will echo its port back, by default 11311.

Open up a new command-line window and use netcat or telnet to connect to the server and start an interactive TCP session:

```
telnet localhost 11311

OR

nc localhost 11311
```

The node server will respond and you've started a new session. To start, let's try asking for some wisdom from a great philosopher:

```
wisdom
```

You will be immediately granted enlightenment. 

Next, you'll probably want to try acquiring a lock:

```
lock HelloWorld
```

The server should echo back the lock being acquired. 

If you want to see the current status, send the show command:

```
show
```
You will receive a list of currently acquired locks on the server. 

To release the lock, try the release command:

```
release HelloWorld
```

That will let go of the lock, allowing subsequent requests access to it.

From this simple functionality you can more easily coordinate resources between multiple applications distributed between many hosts.

Notes
-------------
Here are some special details about the behavior of the system:

* Commands are NOT case-sensitive; however, lock identifiers are case-sensitive. That means "HelloWorld" is a different lock than "helloworld".
* Blockd does NOT currently implement any system of failover, so all client implementations must decide how to respond during loss of contact with the server.
