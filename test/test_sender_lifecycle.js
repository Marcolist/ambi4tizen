'use strict';
var assert = require('assert'), fs = require('fs'), vm = require('vm');
var EventEmitter = require('events').EventEmitter, create = require('../tv/sender').create;
function harness(duration, interval, captureCost) {
    var now = 1000, task, sends = 0, pending, failure = false, cleanup = true, hold = false;
    var socket = new EventEmitter();
    socket.send = function (packet, offset, length, port, host, done) { sends++; done(null); };
    socket.close = function () {};
    var sender = create({ esp_ip: '127.0.0.1', port: 19446, key_hex: new Array(33).join('ab'), zones: 6,
        interval_ms: interval === undefined ? 500 : interval, duration_ms: duration, resolution: '160x90', edge_depth: .1 }, {
        socket: socket, clock: function () { return now; },
        setTimeout: function (fn, delay) { assert(!task); task = { fn: fn, due: now + delay }; return task; },
        clearTimeout: function () { task = null; },
        capture: function (opts, summarize, done) {
            var started = now;
            pending = function () { now += captureCost || 0; done({ status: failure ? 'error' : 'ok', started_ms: started,
                temporary_file_removed: cleanup, colors: { sections: [2, 2, 2],
                    zones_rgb: [[1,2,3],[1,2,3],[1,2,3],[1,2,3],[1,2,3],[1,2,3]] } }); };
            if (!hold) pending();
        }
    });
    return { sender: sender, socket: socket, sends: function () { return sends; },
        advance: function () { assert(task); var t = task; task = null; now = t.due; t.fn(); },
        scheduled: function () { return !!task; }, fail: function () { failure = true; },
        delay: function () { return task ? task.due - now : null; },
        noCleanup: function () { cleanup = false; }, hold: function () { hold = true; },
        complete: function () { pending(); }
    };
}
var continuous = harness(0); continuous.sender.start();
for (var i = 0; i < 10000; i++) continuous.advance(); // Beyond the old one-hour ceiling.
assert.strictEqual(continuous.sends(), 10001); assert(continuous.sender.metrics().running);
assert(continuous.sender.metrics().continuous); continuous.sender.stop();
assert(!continuous.scheduled()); assert.strictEqual(continuous.sender.metrics().stop_reason, 'requested');
var bounded = harness(1000); bounded.sender.start(); bounded.advance(); bounded.advance();
assert.strictEqual(bounded.sends(), 2); assert(!bounded.sender.metrics().running);
assert.strictEqual(bounded.sender.metrics().stop_reason, 'duration');
var errors = harness(0); errors.fail(); errors.sender.start(); errors.advance(); errors.advance();
assert.strictEqual(errors.sender.metrics().errors, 3); assert(!errors.scheduled());
assert.strictEqual(errors.sender.metrics().stop_reason, 'capture_errors');
var cleanup = harness(0); cleanup.noCleanup(); cleanup.sender.start();
assert.strictEqual(cleanup.sender.metrics().stop_reason, 'cleanup_error'); assert(!cleanup.scheduled());
var draining = harness(0); draining.hold(); draining.sender.start(); assert(draining.sender.busy());
draining.sender.stop(); draining.complete(); assert(!draining.sender.busy()); assert.strictEqual(draining.sends(), 0);
var socketError = harness(0); socketError.sender.start(); socketError.socket.emit('error', new Error('injected'));
assert.strictEqual(socketError.sender.metrics().stop_reason, 'socket_error'); assert(!socketError.scheduled());
assert.throws(function () { harness(0, 249).sender.start(); });
var fast = harness(0, 250, 100); fast.sender.start(); assert.strictEqual(fast.delay(), 150);
fast.advance(); assert.strictEqual(fast.delay(), 150); assert.strictEqual(fast.sender.metrics().last_sent.age_ms, 100); fast.sender.close();
var slow = harness(0, 250, 400); slow.sender.start();
for (var trial = 0; trial < 10; trial++) { assert.strictEqual(slow.delay(), 0); slow.advance(); }
assert.strictEqual(slow.sends(), 11); assert.strictEqual(slow.sender.metrics().last_sent.age_ms, 400);
assert.strictEqual(slow.sender.metrics().errors, 0); slow.sender.close();

// Exercise the actual service lifecycle with a stub sender/HTTP server: no TV/network access.
[0, 30000].forEach(function (duration) {
    var timers = [], starts = 0, stops = 0, request, exited = false;
    var server = { on: function () {}, listen: function () {}, close: function (done) { if (done) done(); } };
    var context = { module: { exports: {} }, JSON: JSON,
        process: { exit: function () { exited = true; } },
        setTimeout: function (fn, delay) { timers.push({ fn: fn, delay: delay }); return timers.length; }, clearTimeout: function () {},
        require: function (name) {
            if (name === './sender') return { create: function () { return {
                start: function () { starts++; }, stop: function () { stops++; }, close: function () {},
                busy: function () { return false; }, metrics: function () { return { running: true }; }
            }; } };
            assert.strictEqual(name, 'http'); return { createServer: function (fn) { request = fn; return server; } };
        }
    };
    var config = { enabled: true, duration_ms: duration, developer_ip: '127.0.0.1', diagnostic_token: 'synthetic' };
    vm.runInNewContext(fs.readFileSync('tv/service.js', 'utf8').replace('/*__SENDER_CONFIG__*/null', JSON.stringify(config)), context);
    context.module.exports.onStart(); context.module.exports.onStart(); assert.strictEqual(starts, 1);
    assert.strictEqual(timers.length, duration ? 1 : 0);
    if (duration) assert.strictEqual(timers[0].delay, 35000);
    var status;
    var response = { writeHead: function (code) { status = code; }, end: function () {} };
    request({ connection: { remoteAddress: '127.0.0.1' }, headers: {}, method: 'POST', url: '/stop' }, response);
    assert.strictEqual(status, 403); assert.strictEqual(stops, 0);
    request({ connection: { remoteAddress: '127.0.0.1' }, headers: { authorization: 'Bearer synthetic' }, method: 'POST', url: '/stop' }, response);
    assert.strictEqual(status, 200); assert(exited && stops === 1);
});
var listeners = {}, launches = 0, hidden = 0, success;
var ui = { window: {}, document: { hidden: false, addEventListener: function (name, fn) { listeners[name] = fn; } },
    tizen: { application: { launch: function (id, ok) { launches++; success = ok; },
        getCurrentApplication: function () { return { hide: function () { hidden++; ui.document.hidden = true; }, exit: function () {} }; }
    } }
};
vm.runInNewContext(fs.readFileSync('tv/index.html', 'utf8').split('<script>')[1].split('</script>')[0], ui);
ui.window.onload(); listeners.visibilitychange(); assert.strictEqual(launches, 1); success();
assert.strictEqual(hidden, 1); listeners.visibilitychange(); assert.strictEqual(launches, 1);
ui.document.hidden = false; listeners.visibilitychange(); assert.strictEqual(launches, 2);
console.log('PASS sender lifecycle: continuous, deadline, manual/in-flight stop, errors, authenticated shutdown and UI reopen');
