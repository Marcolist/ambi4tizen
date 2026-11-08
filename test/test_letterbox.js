'use strict';
var assert = require('assert'), fs = require('fs'), zones = require('../tv/zones');
function image(w, h, top, bottom, color) {
    var data = new Uint8Array(w * h * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 3, rgb = y < top || y >= h - bottom ? [5,5,5] : color;
        data[p] = rgb[0]; data[p + 1] = rgb[1]; data[p + 2] = rgb[2];
    }
    return { width: w, height: h, data: data };
}
function topIsLit(result) {
    result.zones_rgb.slice(result.sections[0], result.sections[0] + result.sections[1]).forEach(function (rgb) {
        assert(rgb[0] > 150 && rgb[1] > 50);
    });
}
var film = image(480, 270, 35, 35, [180,80,20]);
[6,12,18,24].forEach(function (count) {
    var result = zones.summarize(film, count, .1);
    assert(result.letterbox); assert.strictEqual(result.sample_rect.y, 36);
    assert.strictEqual(result.sample_rect.height, 198); topIsLit(result);
});
var sample = zones.createSampler(12, .1);
assert(!sample(film).letterbox); // Reject a single-frame black border.
var cropped = sample(film); assert(cropped.letterbox); topIsLit(cropped);
var black = image(480, 270, 0, 0, [0,0,0]);
var fade = sample(black); assert.deepEqual(fade.sample_rect, cropped.sample_rect);
fade.zones_rgb.forEach(function (rgb) { assert.deepEqual(rgb, [0,0,0]); });
var subtitles = image(480, 270, 35, 35, [180,80,20]);
for (var y = 250; y < 260; y++) for (var x = 160; x < 320; x++) {
    var p = (y * 480 + x) * 3; subtitles.data[p] = subtitles.data[p + 1] = subtitles.data[p + 2] = 255;
}
assert(sample(subtitles).letterbox); topIsLit(sample(subtitles));
var full = image(480, 270, 0, 0, [180,80,20]);
assert(sample(full).letterbox); // A flash/menu cannot immediately release the crop.
sample(black); assert(sample(full).letterbox); assert(sample(full).letterbox);
assert(!sample(full).letterbox); // Persistent real full-frame content releases it.
assert(!zones.summarize(image(480, 270, 35, 0, [180,80,20]), 12, .1).letterbox);
assert(!zones.summarize(image(480, 270, 8, 3, [180,80,20]), 12, .1).letterbox);
assert(!zones.summarize(black, 12, .1).letterbox);
assert(!zones.summarize(image(480, 270, 0, 0, [8,8,8]), 12, .1).letterbox);
var smaller = image(160, 90, 12, 12, [180,80,20]);
assert(!sample(smaller).letterbox); assert(sample(smaller).letterbox);
var jpeg = require('../poc/web-probe/vendor/jpeg-decoder')(fs.readFileSync('test/output/letterbox.jpg'), { useTArray: true, formatAsRGBA: false });
var compressed = zones.summarize(jpeg, 12, .1);
assert(compressed.letterbox); assert(compressed.sample_rect.y >= 33 && compressed.sample_rect.y <= 38);
topIsLit(compressed);
console.log('PASS letterbox: content-edge colors, JPEG bars, dark fades, subtitles, full-frame release and dimension changes');
