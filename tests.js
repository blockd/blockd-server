var assert = require("assert");

var blockd = require("blockd.js");

assert.equal(blockd.LockRequestQueue != undefined, true);

describe('Array', function(){
  describe('#indexOf()', function(){
    it('should return -1 when the value is not present', function(){
      assert.equal(-1, [1,2,3].indexOf(5));
      assert.equal(-1, [1,2,3].indexOf(0));
    })
  })
})
