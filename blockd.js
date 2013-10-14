// CONFIGURATION VARIABLES

var settings = require("./settings.json");


// UTILITIES

///
/// Utiltity function for logging
///
function log(data)
{
	console.log(data);
}

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
		log("Error writing to socket:" + err.message);
		return false;
	}
}


// PROTOTYPE EXTENSIONS

///
/// Removes leading and trailing whitespaces
///
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
	
	log("Waiting for lock " + lockId);
	
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
	/// Returns true if this queue has requests in it
	///
	this.hasRequests = function() {

		return this.requests.length > 0;
	};
	
	///
	/// Creates a new lock request and adds it to the queue
	/// Will callback the given function if the request lives to the end of life
	/// Callback should be of the form: function(request)
	///
	this.createRequest = function(socket, lockId, timeout, callbackOnTimeout) {
		
		log("Queueing request for lock " + lockId + " for " + timeout)
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
		
		return this.requests.findAndRemoveIf(function(item) { return item.lockId == lockId; });
	};

	///
	/// Finds the highest priority pending lock request for the given lockId
	/// If not lockId found, return null
	///
	this.findPendingRequest = function() {
		
		return this.requests.findAndRemoveIf(function(item) { return true; });
	};
};

// Add to exports for this module
exports.LockCollection = LockRequestQueue;

///
/// A lock supporting many readers simultaneous readers and one writer
/// This manages its own queue of requests
/// This can configure whether or not it forces new readers to wait once a write request arrives (not greedy) or whether it allows new readers when a waiting write request is there
///
var ReaderWriterLock = function(lockId, greedyReaders) {

	this.lockId = lockId;
	this.greedyReaders = greedyReaders || settings.defaultReaderGreed;

	this.writer = null;
	this.writerQueue = new LockRequestQueue();
	
	this.readers = [];
	this.readerQueue = new LockRequestQueue();
	
	///
	/// Returns true if currently writer locked; otherwise, returns false
	///
	this.isWriteLocked = function() {
		
		return this.writer != null;
	};
	
	///
	/// Returns true if there are currently requesters holding the writer lock; otherwise, returns false
	/// NOTE: This returns false if currently write locked
	///
	this.isReadLocked = function() {
	
		return this.readers.length > 0;
	};

	///
	/// Returns true if the read lock is available; otherwise returns false
	/// NOTE: This factors in the reader greed setting when making its determination
	///
	this.isReadAvailable = function() {
		
		if(this.greedyReaders) {
			
			// If we have greedy readers, then read is available as long as there is no write locks currently in place
			return !this.isWriteLocked();
		} else {

			// If we're not in greed mode, then read is only available when no one is writing and no one is waiting to write
			return !this.isWriteLocked() && !this.writerQueue.hasRequests();
		}
	};

	///
	/// Returns true if this lock has no one holding it and no one waiting for it; otherwise, return false
	///
	this.isAbandoned = function() {

		return !this.isWriteLocked() && !this.isReadLocked() && !this.readerQueue.hasRequests() && !this.writerQueue.hasRequests();
	};

	/// 
	/// Scans the list of readers to see if the given socket is one of the readers
	///
	this.isSocketReader = function(socket) {

		for(var i = 0; i < this.readers.length; ++i) {
			var readerSocket = this.readers[i];
			if(readerSocket === socket)
				return true;
		}

		return false;
	};

	///
	/// Returns true if the write lock is available
	///
	this.isWriteAvailable = function(socket) {

		// If we were given a socket to compare against, then check the case where we might be able to upgrade
		if(socket) {

			// If not write locked and 
			if(!this.isWriteLocked() && this.readers.length == 1 && this.isSocketReader(socket)) {
				log("Able to upgrade read to write for lock " + this.lockId);
				return true;
			}
		}

		// We have to be completely open for write to be available
		return !(this.isWriteLocked() || this.isReadLocked());
	};

	///
	/// Does the real action of applying the read lock
	///
	this.lockRead = function(socket) {

		// Indicate lock set
		log("Read locking " + this.lockId + "\n");
		
		// If this throw an error, then we know the socket is dead and we want the caller to try again
		socket.write("LOCKED R " + this.lockId + "\n");

		// Add to the list of readers
		this.readers.push(socket);
	};

	///
	/// Does the real action of applying the write lock
	///
	this.lockWrite = function(socket) {

		// Be sure to remove any readers this might have
		this.readers.remove(socket);

		// Indicate lock set
		log("Write locking " + this.lockId + "\n");
		
		// If this throw an error, then we know the socket is dead and we want the caller to try again
		socket.write("LOCKED W " + this.lockId + "\n");

		// Add to the list of readers
		this.writer = socket;
	};
	
	///
	/// This will cause a socket to either immediately acquire the write lock or go into a queue waiting for it
	///	
	this.acquireRead = function (socket, timeout) {

		// Use default if not available
		timeout = timeout || settings.defaultTimeout;

		// Double-check this socket is not currently a reader
		if(this.isSocketReader(socket) || this.writer === socket) {

			log("Reader attempting to acquire lock already held: " + this.lockId);
			socket.write("LOCKED R " + this.lockId + "\n");

			return;
		}

		// If we can acquire now, then do it!
		if(this.isReadAvailable()) {

			this.lockRead(socket);
		} else {

			// Respond with Pending status
			writeSafe(socket, "LOCKPENDING R " + this.lockId + "\n");

			// If we have to wait, then queue
			var lock = this;
			this.readerQueue.createRequest(socket, this.lockId, timeout, function(request) {
				
				// if the lock is available, then lock it
				if(lock.isReadAvailable()) {
					
					this.lockRead(socket);
				} else {

					request.timeout();
				}
			});
		}
	};
	
	///
	/// This will cause a socket to either immdiately acquire the write lock or go into the queue waiting for it
	///
	this.acquireWrite = function(socket, timeout) {

		// Use default if not available
		timeout = timeout || settings.defaultTimeout;

		// Double-check this socket is not currently a reader
		if(this.writer === socket) {

			log("Writer attempting to acquire lock already held: " + this.lockId);
			socket.write("LOCKED W " + this.lockId + "\n");

			return;
		}

		// If we can acquire now, then do it!
		if(this.isWriteAvailable(socket)) {

			this.lockWrite(socket);
		} else {
			
			// Respond with Pending status
			writeSafe(socket, "LOCKPENDING W " + this.lockId + "\n");

			// If we have to wait, then queue
			var lock = this;
			this.writerQueue.createRequest(socket, this.lockId, timeout, function(request) {
				
				// if the lock is available, then lock it
				if(lock.isWriteAvailable()) {
					
					this.lockWrite(socket);
				} else {
					
					request.timeout();
				}
			});
		}
	};

	///
	/// This will use the current state of the lock to determine who's next
	///
	this.abdicateLock = function() {

		// NOTE: In theory, the readAvailable/writeAvailable logic ensures these do not both happen

		// Burn through all possible read requests
		while(this.readerQueue.hasRequests() && this.isReadAvailable()) {

			var nextReader = this.readerQueue.findPendingRequest();
			if(nextReader != null)
				this.lockRead(nextReader.socket);
		}

		// Apply the writer
		if(this.writerQueue.hasRequests() && this.isWriteAvailable()) {

			var nextWriter = this.writerQueue.findPendingRequest();
			this.lockWrite(nextWriter.socket);
		}
	}
	
	///
	/// This will cause the given socket to release its lock on it (be it read or write)
	///
	this.release = function(socket, reportNoLocks) {

		if(reportNoLocks === undefined)
			reportNoLocks = true;

		// If we don't really have a value for socket, the abort quietly
		if(!socket)
			return;
		
		var someLockReleased = false;

		// Check if we're releasing the writer
		if(this.writer == socket) {
			
			log("Releasing write lock for " + this.lockId);
			this.writer = null;
			writeSafe(socket, "RELEASED " + this.lockId + "\n");
			someLockReleased = true;
		}

		// Check if we're releasing a reader
		if(this.isSocketReader(socket)) {

			log("Releasing write lock for " + this.lockId);
			this.readers.remove(socket);
			writeSafe(socket, "RELEASED " + this.lockId + "\n");
			someLockReleased = true;
		}

		// If we didn't release anything, then report back
		if(!someLockReleased && reportNoLocks) {
			// Try to notify there is lock lock
			// NOTE: This assumes the socket may be dead
			log("Could not find lock to release by ID" + this.lockId)
			writeSafe(socket, "NOLOCKTORELEASE " + this.lockId + "\n");
			return;
		} else {

			// If we released something, then fire logic to possibly abdicate lock based on new state
			this.abdicateLock();
		}

		return someLockReleased;
	};

	///
	/// Releases all readers and writers for the current lock
	///
	this.releaseAll = function() {

		this.readerQueue.clearRequests();
		this.writerQueue.clearRequests();

		this.release(this.writer);

		var anyLocksReleased = false;
		this.readers.removeIf(function(socket) { return true; },
			function(socket) {
				anyLocksReleased = true;
				this.release(socket);
			});

		return anyLocksReleased;
	};

	///
	/// Returns a string descriptor for the state of this lock
	///
	this.show = function() {

		return this.lockId;
	};
}

// Add to exports for this module
exports.ReaderWriterLock = ReaderWriterLock;

///
/// A collection of locks
///
var LockCollection = function() {

	// Thanks Nate :) No protype = no hacking
	this.locks = Object.create(null);
	this.lockQueue = new LockRequestQueue();

	///
	/// Gets the lock associated with the given ID
	///
	this.getLock = function(lockId) {

		if(!(lockId in this.locks))
			this.locks[lockId] = new ReaderWriterLock(lockId);

		return this.locks[lockId];
	};

	///
	/// Checks if the given lockId is abandoned and deletes it if available
	/// This keeps abandoned instances of the ReaderWriter lock from lingering in memory
	///
	this.cleanupLock = function(lock) {

		if(lock.isAbandoned()) {
			log("Deleting lock instance for " + lock.lockId);
			delete this.locks[lock.lockId];
		}
	};
	
	///
	/// Acquires the given read lock
	///
	this.acquireRead = function(socket, lockId, timeout) {
		
		var lock = this.getLock(lockId);

		lock.acquireRead(socket, timeout);
	};

	///
	/// Acquire the given write lock
	///
	this.acquireWrite = function(socket, lockId, timeout) {

		var lock = this.getLock(lockId);

		lock.acquireWrite(socket, timeout);
	};
	
	///
	/// Releases the given lock, then passes it to anyone waiting
	///
	this.release = function(socket, lockId) {
		
		var lock = this.getLock(lockId);

		lock.release(socket);

		this.cleanupLock(lock);
	};
	
	///
	/// Sends back a comma-delimited list of locks, describing those currently held
	///
	this.show = function(socket) {
		
		log("Showing locks");
				
		var ret = "";
		
		for(var lockId in this.locks) {
			
			ret = ret != "" ? ret + "," : ret;
			 
			var lock = this.locks[lockId];
			ret += lock.show();
		}
		
		return ret;
	};
	
	///
	/// Releases all lock held by the given socket
	///
	this.releaseAll = function(socket) {
		
		log("Releasing ALL locks for the socket");
		
		var locksReleased = false;

		for(var lockId in this.locks) {
			var lock = this.locks[lockId];
			var anyLockRelease = lock.release(socket, false);
			locksReleased = anyLockRelease ? true : locksReleased;
			if(lock.isAbandoned())
				delete this.locks[lockId];
		}

		if(!locksReleased) {

			writeSafe(socket, "NOLOCKSTORELEASEALL\n");
		}
	};
};

// Add to exports for this module
exports.LockCollection = LockCollection;

// Bring in the file of great wisdom
var dolph = require("./dolph.json");

///
/// An interface from text commands to the lock collection, etc
///
var LockInterface = function(net) {
	
	this.net = net;
	
	this.locks = new LockCollection();
	
	///
	/// Responds to the show command with info for all locks
	///
	this.show = function(socket) {
		
		var description = this.locks.show();
		writeSafe(socket, "SHOW " + description + "\n");
	};
	
	///
	/// Responds with a spiritually useful quote from a great philosopher
	///
	this.wisdom = function(socket) {
		
		var randomIndex = Math.floor(Math.random()*dolph.length);

		var quote = dolph[randomIndex];
		
		writeSafe(socket, "WISDOM " + quote + "\n");
	};
	
	///
	/// Receives the socket data event and acts according to its command
	///
	this.onSocketData = function(socket, data) {
		
		data = data.toString().trim();
		
		log("Received data: '" + data + "'\n");
		
		var args = data.split(" ");
		var commandName = args[0];
		
		commandName = commandName.toUpperCase();
		
		switch(commandName) {
			
			case "WISDOM":
				this.wisdom(socket);
				break;
			
			case "ACQUIRE":

				// Check arguments
				if(args[1] == undefined) {
					socket.write("CANNOTACQUIREINVALIDLOCKID");
					break;
				}

				var mode = args[3] || "W";
				mode = mode.toUpperCase();
				if(mode == "W")
					this.locks.acquireWrite(socket, args[1], args[2]);
				else
					this.locks.acquireRead(socket, args[1], args[2]);
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
		
		this.locks.releaseAll(socket);
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
			log("Listening on port " + settings.port);
		});
	}
};

// START

var net = require('net');

var interface = new LockInterface(net);

interface.start();