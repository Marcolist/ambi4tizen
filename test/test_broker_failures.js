'use strict';
var assert = require('assert'), EventEmitter = require('events').EventEmitter;
var make = require('../tv/persistent-broker').create;
function client(helloError, callError) {
    var bus = { connection: new EventEmitter(), invokeDbus: function (opts, done) { done(helloError, ':1.123'); },
        invoke: function (opts, done) { done(callError); } };
    bus.connection.stream = { destroy: function () {} }; return bus;
}
var first = make({ client: function () { return client(new Error('denied')); } });
first.call({}, function (err) { assert(err && err.retrySafe, 'Hello failure may safely fall back before capture'); });
first.close();
var sent = make({ client: function () { return client(null, new Error('reply lost')); } });
sent.call({}, function (err) { assert(err && !err.retrySafe, 'A submitted capture must never be repeated'); });
sent.call({}, function (err) { assert(err && err.retrySafe, 'The next frame may use the process fallback'); });
sent.close();
var decoder = require('../tv/native-decoder').create({ spawn: function () {
    var child = new EventEmitter(); child.stdin = new EventEmitter(); child.stdout = new EventEmitter();
    child.stdin.write = function () {}; child.kill = function () {}; return child;
} });
var callbacks = 0;
decoder.decode(new Buffer([255,216,255,217]), 1, function (err) { assert(err); callbacks++; });
decoder.close(); decoder.close(); assert.strictEqual(callbacks, 1, 'close resolves pending work exactly once');
console.log('PASS failure paths: Hello denial, no duplicate submitted capture and native cancellation');
