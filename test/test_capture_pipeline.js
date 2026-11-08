'use strict';
var assert = require('assert'), core = require('../poc/web-probe/capture-core');
var image = { width: 160, height: 90, data: new Uint8Array(160 * 90 * 3) };
function harness(options) {
    var reads = [], decodes = [], results = [], count = 0, active = false;
    function reader(opts, cb) {
        assert(!active, 'at most one broker request'); active = true; count++;
        reads.push(function () { active = false; cb({ status: 'ok', temporary_file_removed: true,
            started_ms: 1000, elapsed_ms: 10, jpeg: new Buffer([255,216,255,217]), profile_ms: {},
            broker: { width: 160, height: 90 } }); });
    }
    reader.stats = function () { return {}; }; reader.close = function () {};
    var capture = core.create({ reader: reader, clock: function () { return 1020; },
        decode: function () { return image; }, native: function () { return {
            decode: function (jpeg, scale, cb) { assert.strictEqual(decodes.length, 0); decodes.push(cb); },
            stats: function () { return {}; }, close: function () {}
        }; } });
    function next() { capture(options, function (img) { return { width: img.width, height: img.height, zones_rgb: [[1,2,3]] }; }, function (r) { assert(!r.jpeg); results.push(r); }); }
    return { capture: capture, next: next, reads: reads, decodes: decodes, results: results, count: function () { return count; } };
}
var h = harness({ pipeline: true, decoder: 'native', decode_scale: 4, interval_ms: 1 });
h.next(); assert.strictEqual(h.count(), 1); h.reads.shift()();
assert.strictEqual(h.count(), 2); assert.strictEqual(h.decodes.length, 1);
h.next(); assert.strictEqual(h.results[0].status, 'limited');
h.decodes.shift()(null, image); assert.strictEqual(h.results[1].status, 'ok');
h.next(); assert(h.capture.busy()); // Waiting for the single in-flight prefetch.
h.capture.stop(); h.reads.shift()(); assert(!h.capture.busy());
assert.strictEqual(h.results[2].error, 'stopped'); assert.strictEqual(h.decodes.length, 0); h.capture.close();

var ready = harness({ pipeline: true, decoder: 'native', interval_ms: 1 });
ready.next(); ready.reads.shift()(); ready.reads.shift()(); // At most one completed image ahead.
assert.strictEqual(ready.count(), 2); ready.decodes.shift()(null, image);
ready.next(); assert.strictEqual(ready.count(), 3); // Consume ready frame and begin exactly one new capture.
ready.capture.stop(); ready.reads.shift()(); ready.decodes.shift()(null, image);
assert(!ready.capture.busy()); ready.capture.close();

var slow = harness({ pipeline: true, decoder: 'native', interval_ms: 1000 });
slow.next(); slow.reads.shift()(); assert.strictEqual(slow.count(), 1, 'no early prefetch at a slow cadence');
slow.decodes.shift()(null, image); slow.capture.close();

var fallback = harness({ pipeline: false, decoder: 'auto' });
fallback.next(); fallback.reads.shift()(); fallback.decodes.shift()(new Error('unavailable'));
assert.strictEqual(fallback.results[0].status, 'ok'); assert.strictEqual(fallback.results[0].decoder_backend, 'js');
assert.strictEqual(fallback.capture.stats().native_fallbacks, 1); fallback.capture.close();
console.log('PASS capture pipeline: bounded lookahead, no overlap, slow-cadence freshness, stop/drain and native fallback');
