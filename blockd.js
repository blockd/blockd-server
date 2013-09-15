// CONFIGURATION VARIABLES

///
/// The default timeout for a lock request
///
var defaultTimeout = 2000;

///
/// Port on which the system will listen for connections
///
var port = 8000;

// UTILITIES

String.prototype.trim = function() {
	return this.replace(/^\s+|\s+$/g,"");
}

// CONSTRUCTORS

///
/// An object that tracks a lock
///
var Lock = function(socket, lockId) {
	
	// Properties for later
	this.socket = socket;
	this.lockId = lockId;
	
	// Indicate lock set
	console.log("Locking " + lockId + "\n");
	socket.write("LOCKED " + lockId + "\n");
	
	///
	/// Releases this lock, notifying the connection
	///
	this.release = function() {
		
		console.log("Releasing " + this.lockId);
		
		try
		{
			this.socket.write("RELEASED " + lockId + "\n");
		}
		catch(err)
		{
			console.log("Error releasing lock:" + err.message)
		}
	}
};

///
/// A request for a lock that we must
///
var LockRequest = function(socket, lockId) {
	
	// Properties for later
	this.socket = socket;
	this.lockId = lockId;
	
	console.log("Waiting for lock " + lockId);
};

///
/// A queue for managing lock requests
///
var LockRequestQueue = function() {

	// The queue of requests (earlier is better)
	this.requests = [];
	
	///
	/// Creates a new lock request and adds it to the queue
	///
	this.createRequest = function(socket, lockId) {
		
		var request = new LockRequest(socket, lockId);
		this.requests.push(request);
		return request;
	};
	
	///
	/// Removes the given lock request from the array
	/// Returns true if removed; otherwise, returns false
	/// Returning false indicte request was dead
	///
	this.removeRequest = function(request) {
		
		var index = this.requests.indexOf(request);
		
		if(index >= 0) {
			this.requests.splice(index, 1);
			return true;
		} else {
			return false;
		}
	};
	
	///
	/// Returns true if the given request is still waiting; otherwise, false
	///
	this.isRequestStillWaiting = function(request) {
		
		return this.requests.indexOf(request) >= 0;
	};
	
	///
	/// Clears all requests
	///
	this.clearRequests = function() {
		this.requests = [];
	};
	
	///
	/// Clears all requests for the given socket
	///
	this.clearRequestsForSocket = function(socket) {
	
		var i =0;
		
		while(i < this.requests.length) {
			
			var request = this.requests[i];
			
			if(request.socket === socket) {
				// remove from the queue
				this.requests.splice(i, 1);
			} else {
				i++;
			}
		}
	};
	
	///
	/// Finds the highest priority pending lock request for the given lockId
	/// If not lockId found, return null
	///
	this.findPendingRequestForLock = function(lockId) {
		
		var i =0;
		
		while(i < this.requests.length) {
			
			var request = this.requests[i];
			
			if(request.lockId === lockId) {
				// remove from the queue
				this.requests.splice(i, 1);
				return request;
			}
		}
		
		return null;
	};
};

///
/// The master object orchestrating locks and releases
///
var LockBroker = function(net) {
	
	this.net = net;
	this.locks = {};
	this.lockQueue = new LockRequestQueue();
	
	///
	/// Returns true if the given lock ID is occupied; otherwise returns false
	///
	this.isLocked = function(lockId) {
		
		return lockId in this.locks;
	};
	
	///
	/// Locks for the given socket and lockId
	///
	this.lock = function(socket, lockId) {
		
		this.locks[lockId] = new Lock(socket, lockId);
	};
	
	///
	/// Acquires the given lock
	///
	this.acquire = function(socket, lockId, timeout) {
		
		if(!this.isLocked(lockId)) {
			this.lock(socket, lockId);
		} else {
			
			// Make a new request
			var request = this.lockQueue.createRequest(socket, lockId);

			var broker = this;			
			setTimeout(function() {
				
				// If it's not still waiting, then cancel this
				if(!broker.lockQueue.removeRequest(request)) {
					return;
				}
				
				// if the lock is available, then lock it
				if(!broker.isLocked(lockId)) {
					broker.lock(socket, lockId);
				} else {
					// if the lock is still not available, then we timeout
					console.log("Timing out " + lockId + "\n");
					socket.write("ACQUIRETIMEOUT " + lockId + "\n");
				}
			}, timeout);
		}
	};
	
	///
	/// Releases the given lock, then passes it to anyone waiting
	///
	this.release = function(socket, lockId) {
		
		// Retrieve the lock
		var lock = this.locks[lockId] || false;
		
		// If we didn't find anything, then return an error
		if(lock === false) {
			
			socket.write("NOLOCKTORELEASE " + lockId + "\n");
			return;
		} 
		
		// Release the lock
		lock.release();
		delete this.locks[lockId];
		
		// Go look for a request to fill the lock
		var request = this.lockQueue.findPendingRequestForLock(lockId);
		if(request != null) {
			// apply the lock
			this.lock(request.socket, request.lockId);
		}
	};
	
	///
	/// Responds with a spiritually useful quote from a great philosopher
	///
	this.wisdom = function(socket) {
		
		var quote = "I win for me! FOR ME! - Drago";
		
		socket.write("WISDOM " + quote + "\n");
	};
	
	///
	/// Sends back a description of all current locks
	///
	this.show = function(socket) {
		
		socket.write("SHOW\n");
		for(var lockId in this.locks) {
			var lock = this.locks[lockId];
			socket.write(lock.lockId + "\n");
		}
	};
	
	///
	/// Releases all held locks
	///
	this.releaseAll = function(socket) {
		
		for(var lockId in this.locks) {
			var lock = this.locks[lockId];
			lock.release();
		}
		
		this.locks = {};
	};
	
	///
	/// Receives the socket data event and acts according to its command
	///
	this.onSocketData = function(socket, data) {
		
		data = data.toString().trim();
		
		console.log("Received data: '" + data + "'\n");
		
		var args = data.split(" ");
		var commandName = args[0];
		
		commandName = commandName.toUpperCase();
		
		switch(commandName) {
			
			case "WISDOM":
				this.wisdom(socket);
				break;
			
			case "ACQUIRE":
				this.acquire(socket, args[1], args[2] || defaultTimeout);
				break;
				
			case "RELEASE":
				this.release(socket, args[1]);
				break;
				
			case "RELEASEALL":
				this.releaseAll(socket);
				break;
				
			case "SHOW":
				this.show(socket);
				break;
				
			default:
				socket.write("COMMANDNOTFOUND\n");
		}
	};
	
	///
	/// Receives the socket disconnect event
	///
	this.onSocketDisconnect = function(socket) {
		
		console.log("Socket Disconnected");
		this.lockQueue.clearRequestsForSocket(socket);
	};
	
	///
	/// Performs setup and starts listening for connections
	///
	this.start = function () {
		
		var broker = this;
		
		var server = net.createServer(function(socket){
	
			console.log("Socket Connected...");

			socket.write("IMUSTBLOCKYOU\n");
	
			socket.on("data", function(data) {
				broker.onSocketData(socket, data);
			});
	
			socket.on("end", function() {
				broker.onSocketDisconnect(socket);
			});
		});
	
		server.listen(port, function() {
			console.log("Listening on port " + port);
		});
	}
};


// START

var net = require('net');

var broker = new LockBroker(net);

broker.start();

