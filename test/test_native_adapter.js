'use strict';
var assert = require('assert'), fs = require('fs'), cp = require('child_process'), path = require('path');
var worker = path.resolve('.local/tv-native/host/ambi-jpeg');
if (!fs.existsSync(worker)) { console.log('SKIP native adapter: host worker not built'); process.exit(0); }
var starts = 0, decoder = require('../tv/native-decoder').create({ worker: worker,
    spawn: function (file, args, opts) { starts++; return cp.spawn(file, args, opts); } });
var jpeg = fs.readFileSync('test/output/fixture.jpg');
decoder.decode(jpeg, 4, function (err, image) {
    assert.ifError(err); assert.strictEqual(image.source_width, 160); assert.strictEqual(image.source_height, 90);
    assert.strictEqual(image.width, 80); assert.strictEqual(image.height, 45);
    var colors = require('../tv/zones').summarize(image, 12, .1).zones_rgb;
    assert(colors[0][2] > 200); assert(colors[11][0] > 200 && colors[11][1] > 200);
    decoder.decode(new Buffer('not a jpeg'), 4, function (bad) {
        assert(bad);
        decoder.decode(jpeg, 2, function (last, result) {
            assert.ifError(last); assert.strictEqual(result.data.length, result.width * result.height * 3);
            assert.strictEqual(starts, 1); assert.strictEqual(decoder.stats().decoded, 2);
            decoder.decode(fs.readFileSync('test/output/letterbox.jpg'), 4, function (barError, film) {
                assert.ifError(barError); assert.strictEqual(film.source_width, 480); assert.strictEqual(film.width, 120);
                var sample = require('../tv/zones').createSampler(12, .1);
                assert(!sample(film).letterbox); var cropped = sample(film); assert(cropped.letterbox);
                cropped.zones_rgb.slice(3, 9).forEach(function (rgb) { assert(rgb[0] > 150 && rgb[1] > 50); });
                decoder.close();
                console.log('PASS native adapter: persistent helper, scaled colors/letterbox and JPEG-error recovery');
            });
        });
    });
});
