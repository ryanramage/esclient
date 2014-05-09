
var util = require('util'),
    stream = require('stream');

var BufferedBulkStream = function( client, options )
{
  this.client = client;
  this.buffer = [];
  this.options = options || { buffer: 1000, timeout: 1000 }
  this.stats = { written: 0, inserted: 0, ok: 0, error: 0 }
  this.timeout = null;

  // Call constructor from stream.Writable
  stream.Writable.call( this, { objectMode: true } );

  // Log errors to stderr
  this.on( 'error', console.error.bind( console ) );

  // Try to flush when the stream ends
  this.on( 'end', this.flush.bind( this, true ) );
}

// Inherit prototype from stream.Writable
util.inherits( BufferedBulkStream, stream.Writable )

// Handle new messages on the stream
BufferedBulkStream.prototype._write = function( chunk, enc, next )
{
  // BufferedBulkStream accepts Objects or JSON encoded strings
  var record = this.parseChunk( chunk );

  // Record message error stats
  this.stats[ record? 'ok':'error' ]++;

  if( record )
  {
    // Push command to buffer
    this.buffer.push({ index: {
      _index: record._index,
      _type: record._type,
      _id: record._id
    }}, record.data );
    
    this.flush();
  }

  next();
};

// Flush buffer to client
BufferedBulkStream.prototype.flush = function( force )
{
  // Buffer not full
  if( !force && ( this.buffer.length / 2 ) < this.options.buffer ){ return; }

  // Move commands out of main buffer
  var writeBuffer = this.buffer.splice( 0, this.options.buffer * 2 );
  
  // Write buffer to client
  this.stats.written += this.options.buffer;
  this.client.bulk({ body: writeBuffer }, function( err, resp ){
    if( err ){
      console.error( 'bulk insert error', err );
      this.emit( 'error', err );
    }
    this.stats.inserted += this.options.buffer;
  }.bind(this));

  // Logging
  console.error( 'writing %s records to ES', this.options.buffer, {
    written: this.stats.written,
    inserted: this.stats.inserted,
    queued: this.stats.written - this.stats.inserted
  });

  // Handle partial flushes due to inactivity
  clearTimeout( this.timeout );
  this.timeout = setTimeout( function(){
    this.flush( true );
  }.bind(this), this.options.timeout );
}

// BufferedBulkStream accepts Objects or JSON encoded strings
BufferedBulkStream.prototype.parseChunk = function( chunk )
{
  if( 'string' === typeof chunk ){
    try {
      chunk = JSON.parse( chunk.toString() );
    } catch( e ){
      this.emit( 'error', 'failed to parse JSON chunk' );
      return;
    }
  }
  
  if( 'object' === typeof chunk ){
    if( !chunk._index ){
      this.emit( 'error', 'invalid index specified' );
      return;
    } else if( !chunk._type ){
      this.emit( 'error', 'invalid type specified' );
      return;
    } else if( !chunk._id ){
      this.emit( 'error', 'invalid id specified' );
      return;
    }
    
    // Chunk is valid
    return chunk;
  }

  this.emit( 'error', 'invalid bulk API message' );
  return;
}

module.exports = BufferedBulkStream;