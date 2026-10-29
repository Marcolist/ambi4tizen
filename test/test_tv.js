'use strict';
// Run this under the actual Node 4.4.3 host runtime as well as current Node.
var assert = require('assert'), fs = require('fs'), EventEmitter = require('events').EventEmitter;
var core = require('../poc/web-probe/capture-core'), zones = require('../tv/zones'), protocol = require('../tv/protocol');
var jpeg = fs.readFileSync('test/output/fixture.jpg'), image = require('../poc/web-probe/vendor/jpeg-decoder')(jpeg, { useTArray: true, formatAsRGBA: false });
var key = new Buffer('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
var session = new Buffer('0102030405060708', 'hex');
var legacy = require('../poc/web-probe/capture').summarize(image);
assert.strictEqual(legacy.zones_rgb.length, 6);
assert(legacy.zones_rgb[0][0] > 220 && legacy.zones_rgb[3][2] > 220);
[6, 12, 18, 24].forEach(function (n) {
    var result = zones.summarize(image, n, 0.1);
    assert.strictEqual(result.zones_rgb.length, n); assert.strictEqual(result.sections.reduce(function (a, b) { return a + b; }), n);
    assert(result.zones_rgb[0][2] > 220); // Bottom left blue; order runs upwards.
    assert(result.zones_rgb[result.sections[0] - 1][0] > 220);
    assert(result.zones_rgb[result.sections[0]][0] > 150);
    assert(result.zones_rgb[n - 1][0] > 220 && result.zones_rgb[n - 1][1] > 220);
    var packet = protocol.encode({ session: session, sequence: 4294967295, capture_ms: 123456, age_ms: 20, sections: result.sections, colors: result.zones_rgb }, key);
    assert.strictEqual(packet.length, 48 + 3 * n); assert(packet.length <= 120);
});
assert.throws(function () { zones.summarize(image, 7, .1); });
assert.throws(function () { zones.summarize(image, 6, 0); });
assert.throws(function () { protocol.encode({ session: session }, key); });
assert.throws(function () { protocol.encode({}, new Buffer(32)); });
var files = {}, calls = 0, pending, fail = '', time = 1000;
function missing() { var error = new Error('missing'); error.code = 'ENOENT'; return error; }
var capture = core.create({ clock: function () { return time++; }, fs: {
    lstatSync: function (path) { assert(files[path]); return { isFile: function () { return true; }, size: files[path].length }; },
    readFileSync: function (path) { return files[path]; },
    unlinkSync: function (path) { if (!files[path]) throw missing(); delete files[path]; }
}, cp: { execFile: function (bin, args, opts, callback) {
    calls++; assert.strictEqual(bin, '/usr/bin/dbus-send'); assert.strictEqual(args[6], 'int32:0');
    assert.strictEqual(args[7], 'int32:0'); assert.strictEqual(args[8], 'int32:1');
    assert.strictEqual(args[9], 'int32:160'); assert.strictEqual(args[10], 'int32:90');
    var path = '/dev/shm/' + args[13].slice(7) + '.jpg';
    files[path] = fail === 'decode' ? new Buffer('invalid jpeg') : jpeg;
    pending = function () {
        var reply = 'int32 0\n int32 160\n int32 ' + (fail === 'dimensions' ? 91 : 90) + '\n string "' + (fail === 'foreign' ? '/foreign/file.jpg' : path) + '"';
        callback(fail === 'exec' ? new Error('timeout') : null, reply);
    };
} } });
var options = { resolution: '160x90', hash: false }, successful = 0;
var synchronous = core.create({ cp: { execFile: function () { throw new Error('spawn failed'); } } });
for (var spawnTrial = 0; spawnTrial < 2; spawnTrial++) synchronous(options, function () {}, function (result) {
    assert.strictEqual(result.status, 'error'); assert(result.temporary_file_removed);
});
function summary(img) { return zones.summarize(img, 12, .1); }
for (var trial = 0; trial < 200; trial++) {
    capture(options, summary, function (result) {
        assert.strictEqual(result.status, 'ok'); assert(result.temporary_file_removed); assert(result.profile_ms.decode >= 0);
        assert.strictEqual(result.colors.zones_rgb.length, 12); successful++;
    });
    capture(options, summary, function (result) { assert.strictEqual(result.status, 'limited'); });
    pending(); assert.strictEqual(Object.keys(files).length, 0);
}
['exec', 'decode', 'dimensions', 'foreign'].forEach(function (failure) {
    fail = failure; capture(options, summary, function (result) { assert.strictEqual(result.status, 'error'); assert(result.temporary_file_removed); });
    pending(); assert.strictEqual(Object.keys(files).length, 0);
});
assert.strictEqual(calls, 204); assert.strictEqual(successful, 200);
var closed = false, fakeSocket = new EventEmitter(), captured = 0, sent = [];
fakeSocket.close = function () { closed = true; };
fakeSocket.send = function (packet, offset, len, port, host, callback) { sent.push(packet); assert.strictEqual(host, '127.0.0.1'); callback(null); };
var config = { esp_ip: '127.0.0.1', port: 19446, key_hex: key.toString('hex'), zones: 12, interval_ms: 500, duration_ms: 1000, resolution: '160x90', edge_depth: .1 };
var sender = require('../tv/sender').create(config, { socket: fakeSocket, clock: function () { return 10000; }, capture: function (opts, summarize, done) {
    captured++; done({ status: 'ok', started_ms: 9990, colors: summarize(image), temporary_file_removed: true, profile_ms: { decode: 1 } });
} });
sender.start(); assert.throws(function () { sender.start(); }); sender.stop(); sender.close();
assert(closed && captured === 1 && sent.length === 1 && sender.metrics().sent === 1);
var last = sender.metrics().last_sent;
assert.strictEqual(last.sequence, sent[0].readUInt32BE(16));
assert.strictEqual(last.age_ms, 10); assert.strictEqual(last.capture_age_ms, 10);
assert.strictEqual(last.width, 160); assert.strictEqual(last.height, 90);
assert.deepEqual(last.sections, summary(image).sections);
assert.deepEqual(last.zones_rgb, summary(image).zones_rgb);
last.zones_rgb[0][0] = -1; assert(sender.metrics().last_sent.zones_rgb[0][0] >= 0);
// Old frames are dropped, errors stop after three attempts, never overlap captures.
closed = false;captured = 0;sent = [];
var stale = require('../tv/sender').create(config, { socket: fakeSocket, clock: function () { return 10000; }, capture: function (opts, summarize, done) {
    captured++; done({ status: 'ok', started_ms: 1, colors: summarize(image), temporary_file_removed: true });
} });
stale.start(); assert.strictEqual(sent.length, 0); assert.strictEqual(stale.metrics().errors, 1);
assert.strictEqual(stale.metrics().last_sent, null);
setTimeout(function () {
    assert.strictEqual(stale.metrics().errors, 3); assert.strictEqual(stale.metrics().running, false);
    stale.close();
    console.log('PASS TV: Node ' + process.version + ', real JPEG x200, all zone counts, no overlap, cleanup/error paths, sender stale drop and stop after 3 errors');
}, 1200);
