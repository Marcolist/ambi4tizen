'use strict';
// Single normal broker request. No mode search, permission changes or frame export.
var busy = false, last = 0, total = 0;

function summarize(image) {
    var w = image.width, h = image.height, data = image.data;
    var zones = [], black = 0, count = w * h;
    for (var row = 0; row < 2; row++) {
        for (var col = 0; col < 3; col++) {
            var sum = [0, 0, 0], n = 0;
            for (var y = Math.floor(row * h / 2); y < Math.floor((row + 1) * h / 2); y++) {
                for (var x = Math.floor(col * w / 3); x < Math.floor((col + 1) * w / 3); x++) {
                    var p = (y * w + x) * 3;
                    for (var c = 0; c < 3; c++) sum[c] += data[p + c];
                    if (data[p] < 8 && data[p + 1] < 8 && data[p + 2] < 8) black++;
                    n++;
                }
            }
            zones.push(sum.map(function (v) { return Math.round(v / n); }));
        }
    }
    return { width: w, height: h, zones_rgb: zones, black_fraction: Math.round(black / count * 10000) / 10000 };
}

exports.summarize = summarize;
var capture = require('./capture-core').create();
exports.once = function (done) {
    var now = Date.now();
    if (busy || now - last < 1500 || total >= 12) return done({ status: 'limited', total: total });
    busy = true; last = now; total++;
    capture({ resolution: '480x270', hash: true }, summarize, function (result) {
        busy = false; result.sample = total; done(result);
    });
};
