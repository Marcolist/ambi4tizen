'use strict';
var assert = require('assert'), fs = require('fs'), decode = require('../poc/web-probe/vendor/jpeg-decoder'), zones = require('../tv/zones');
var options = { useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 1, maxMemoryUsageInMB: 24 };
function preview(jpeg) {
    return decode(jpeg, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
        dcPreview: true, maxResolutionInMP: 1, maxMemoryUsageInMB: 24 });
}
['dc-gradient','dc-odd','dc-gray','dc-min'].forEach(function (name) {
    var jpeg = fs.readFileSync('test/output/' + name + '.jpg'), full = decode(jpeg, options), small = preview(jpeg);
    assert.strictEqual(small.source_width, full.width); assert.strictEqual(small.source_height, full.height);
    assert.strictEqual(small.width, Math.ceil(full.width / 8)); assert.strictEqual(small.height, Math.ceil(full.height / 8));
    assert.strictEqual(small.data.length, small.width * small.height * 3);
    [6,12,18,24].forEach(function (count) {
        var expected = zones.summarize(full, count, .1), actual = zones.summarize(small, count, .1);
        actual.zones_rgb.forEach(function (rgb, index) { rgb.forEach(function (value, channel) {
            assert(Math.abs(value - expected.zones_rgb[index][channel]) <= 12, name + ': color deviation ' + value + ' vs ' + expected.zones_rgb[index][channel]);
        }); });
    });
});
var smallJpeg = fs.readFileSync('test/output/fixture.jpg'), unchanged = preview(smallJpeg), original = decode(smallJpeg, options);
assert.strictEqual(unchanged.preview_scale, 1); assert.strictEqual(unchanged.width, 160);
assert.deepEqual(unchanged.data, original.data);
var film = preview(fs.readFileSync('test/output/letterbox.jpg')), sampler = zones.createSampler(12, .1);
assert.strictEqual(film.width, 60); assert.strictEqual(film.height, 34);
assert(!sampler(film).letterbox); var crop = sampler(film); assert(crop.letterbox);
crop.zones_rgb.slice(3,9).forEach(function (rgb) { assert(rgb[0] > 150 && rgb[1] > 50); });
assert.throws(function () { preview(new Buffer('invalid JPEG')); });
console.log('PASS DC preview: baseline/progressive/subsampling/grayscale, odd dimensions, color means, small fallback and letterbox');
