// CONFIGURATION VARIABLES

var settings = {
	
	///
	/// The default timeout for a lock request
	///
	defaultTimeout : 2000,
	
	///
	/// Port on which the system will listen for connections
	///
	port : 8000
};


// UTILITIES

///
/// Writes the given data to the given socket, suppressing all errors
/// Returns true if write successful; otherwise, returns false
///
function writeSafe(socket, data) {
	
	try
	{
		socket.write(data);
		return true;
	}
	catch(err)
	{
		console.log("Error writing to socket:" + err.message)
		return false;
	}
}

function log(data)
{
	console.log(data);
}

// PROTOTYPE EXTENSIONS

String.prototype.trim = function() {
	return this.replace(/^\s+|\s+$/g,"");
}

///
/// Removes the given item from the array
/// Returns true if removed, else false
///
Array.prototype.remove = function(item) {
	
	// Find the item and remove it via splice if present
	var index = this.indexOf(item);
	if(index > -1) {
		this.splice(index,1);
		return true;
	} else {
		return false;
	}
};

///
/// Scans the array, calling the predicate for each item 
/// Also accepts an optional onRemove(item) function, which can stop the remove by returning true
///
Array.prototype.removeIf = function(predicate, onRemove) {
	
	var i = 0;
	
	// linear search the array
	while(i < this.length) {
		
		var item = this[i];
		
		// test predicate
		if(predicate(item)) {
			
			// remove from the queue
			this.splice(i, 1);

			// if they passed an onRemove function, then call it
			if(onRemove !== undefined) {
				// If the onRemove returns false, then we stop
				if(onRemove(item)) {
					return;
				}
			}
				
		} else {
			i++;
		}
	}
};

///
/// Finds the first item that matches the given predicate, removing and returning it
///
Array.prototype.findAndRemoveIf = function(predicate) {
	
	var retItem = undefined;
	
	this.removeIf(predicate, 
		function(item) {
			retItem = item;
			return true;
	});
	
	return retItem;
	
};

// CONSTRUCTORS

///
/// A request for a lock that we must
///
var LockRequest = function(socket, lockId) {
	
	// Properties for later
	this.socket = socket;
	this.lockId = lockId;
	
	console.log("Waiting for lock " + lockId);
	
	///
	/// Notifies the end client their request is dead
	/// NOTE: This assumes the socket may be dead
	///
	this.timeout = function() {
		
		// if the lock is still not available, then we timeout
		log("Timing out " + this.lockId + "\n");
		writeSafe(this.socket, "ACQUIRETIMEOUT " + lockId + "\n");
	};
};

///
/// A queue for managing lock requests
///
var LockRequestQueue = function() {

	// The queue of requests (earlier is better)
	this.requests = [];
	
	///
	/// Creates a new lock request and adds it to the queue
	/// Will callback the given function if the request lives to the end of life
	/// Callback should be of the form: function(request)
	///
	this.createRequest = function(socket, lockId, timeout, callbackOnTimeout) {
		
		var request = new LockRequest(socket, lockId);
		this.requests.push(request);
		
		// Set a timeout that will only fire the callback if this request is live at the end
		var queue = this;
		setTimeout(function() {
			
			// If it's not still waiting, then cancel this
			if(!queue.removeRequest(request)) {
				return;
			}
			
			callbackOnTimeout(request);
		}, timeout);
		
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
	
		this.requests.removeIf(function(request){
			return request.socket === socket;
		});
	};
	
	///
	/// Finds the highest priority pending lock request for the given lockId
	/// If not lockId found, return null
	///
	this.findPendingRequestForLock = function(lockId) {
		
		return this.requests.findAndRemoveIf(function(item) { return true; });
	};
};

///
/// An object that tracks a lock
/// On first creation, this will notify the socket that they have a lock
/// If creation of this object throws an error, that indicates the socket is unable to accept the lock and a new successor should be chosen
///
var Lock = function(socket, lockId) {
	
	// Properties for later
	this.socket = socket;
	this.lockId = lockId;
	
	// Indicate lock set
	console.log("Locking " + lockId + "\n");
	
	// If this throw an error, then we know the socket is dead and we want the caller to try again
	socket.write("LOCKED " + lockId + "\n");
	
	///
	/// Releases this lock, notifying the connection
	/// NOTE: This assumes the socket may be dead
	///
	this.release = function() {
		
		log("Releasing " + this.lockId);
		writeSafe(this.socket, "RELEASED " + lockId + "\n");
	}
};

///
/// A collection of locks
///
var LockCollection = function() {

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
		
		var newLock = new Lock(socket, lockId);
		this.locks[lockId] = newLock;
	};
	
	///
	/// Acquires the given lock
	///
	this.acquire = function(socket, lockId, timeout) {
		
		timeout = timeout || settings.defaultTimeout;
		
		if(!this.isLocked(lockId)) {
			this.lock(socket, lockId);
		} else {
			
			// Make a new request in the queue
			var broker = this;
			
			this.lockQueue.createRequest(socket, lockId, timeout,
				function(request) {
					
					// if the lock is available, then lock it
					if(!broker.isLocked(lockId)) {
						broker.lock(socket, lockId);
					} else {
						request.timeout();
					}
				});
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
			
			// Try to notify there is lock lock
			// NOTE: This assumes the socket may be dead
			log("Could not find lock to release by ID" + lockId)
			writeSafe(socket, "NOLOCKTORELEASE " + lockId + "\n");
			return;
		} 
		
		// Release the lock
		lock.release();
		delete this.locks[lockId];
		
		// Find a new owner
		this.abdicateLock(lockId);
	};
	
	///
	/// Release all locks and lock requests associated with the given socket
	///
	this.releaseAllForSocket = function(socket) {
		
		// Clear the request queue
		this.lockQueue.clearRequestsForSocket(socket);
		
		// The list of candidates
		var ids = [];
		
		// Iterate through all locks, making a candidate list
		for(var i in this.locks) {
			
			var lock = this.locks[i];
			
			if(lock.socket === socket) {
				ids.push(i);
			}
		}
		
		// Iterate through the candidates and release them
		for(var i = 0; i < ids.length; ++i) {
			var id = ids[i];
			this.release(socket, id);
		}
	}
	
	///
	/// Attempts to find a new holder for the given lockId by analyzing the queue
	///
	this.abdicateLock = function(lockId) {
		
		// Go look for a request to fill the lock
		
		var isSuccessorFound = false;
		
		// Keep trying until we're out of candidates or find a good one
		while(!isSuccessorFound) {
		
			try
			{
				// Look in the queue
				var request = this.lockQueue.findPendingRequestForLock(lockId);
				if(request != null) {
					// if we found one, then try to apply the lock
					this.lock(request.socket, request.lockId);
				} else {
					// No successor found
					isSuccessorFound = true;
				}
				
				isSuccessorFound = true;
			}
			catch(err)
			{
				log("Error trying to abdicate lock " + err.message);
			}
		}
	}
	
	///
	/// Sends back a comma-delimited list of locks, describing those currently held
	///
	this.show = function(socket) {
		
		log("Showing locks");
				
		var ret = "";
		
		for(var lockId in this.locks) {
			
			ret = ret != "" ? ret + "," : ret;
			 
			var lock = this.locks[lockId];
			ret += lock.lockId;
		}
		
		return ret;
	};
	
	///
	/// Releases all held locks
	///
	this.releaseAll = function(socket) {
		
		log("Releasing ALL locks");
		
		for(var lockId in this.locks) {
			var lock = this.locks[lockId];
			lock.release();
		}
		
		this.locks = {};
	};
};

///
/// An interface from text commands to the lock collection, etc
/// This also implements the 
///
var LockInterface = function(net) {
	
	this.net = net;
	
	this.locks = new LockCollection();
	
	this.show = function(socket) {
		
		var description = this.locks.show();
		writeSafe(socket, "SHOW " + description + "\n");
	};
	
	///
	/// Responds with a spiritually useful quote from a great philosopher
	///
	this.wisdom = function(socket) {
		
		var quote = "I win for me! FOR ME! - Drago";
		
		writeSafe(socket, "WISDOM " + quote + "\n");
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
				this.locks.acquire(socket, args[1], args[2]);
				break;
				
			case "RELEASE":
				this.locks.release(socket, args[1]);
				break;
				
			case "RELEASEALL":
				this.locks.releaseAll(socket);
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
		
		this.locks.releaseAllForSocket(socket);
	};
	
	///
	/// Performs setup and starts listening for connections
	///
	this.start = function () {
		
		var broker = this;
		
		var server = net.createServer(function(socket){
	
			log("Socket Connected...");

			// Write to the socket to give it a try, aborting if we can't
			if(!writeSafe(socket, "IMUSTBLOCKYOU\n")) {
				return;
			}
	
			// Register callback for when we receive data
			socket.on("data", function(data) {
				broker.onSocketData(socket, data);
			});
	
			socket.on("end", function() {
				log("Socket Disconnected");
				broker.onSocketDisconnect(socket);
			});
		});
	
		server.listen(settings.port, function() {
			console.log("Listening on port " + settings.port);
		});
	}
};


// START

var net = require('net');

var interface = new LockInterface(net);

interface.start();

