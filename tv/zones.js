'use strict';
var layouts = { 6: [2, 2, 2], 12: [3, 6, 3], 18: [5, 8, 5], 24: [6, 12, 6] };
exports.layout = function (count) {
    if (!layouts[count]) throw new Error('zones must be 6, 12, 18 or 24');
    return layouts[count].slice();
};
exports.summarize = function (image, count, depth) {
    var sections = exports.layout(count), w = image.width, h = image.height, data = image.data;
    if (typeof depth !== 'number' || !isFinite(depth) || depth < 0.02 || depth > 0.25) throw new Error('invalid edge depth');
    if (w < 24 || h < 24 || data.length !== w * h * 3) throw new Error('invalid decoded image');
    var dx = Math.max(1, Math.floor(w * depth)), dy = Math.max(1, Math.floor(h * depth)), colors = [];
    function mean(x0, x1, y0, y1) {
        var sum = [0, 0, 0], n = 0;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
            var p = (y * w + x) * 3;
            sum[0] += data[p]; sum[1] += data[p + 1]; sum[2] += data[p + 2]; n++;
        }
        return sum.map(function (v) { return Math.round(v / n); });
    }
    var j;
    for (j = 0; j < sections[0]; j++) colors.push(mean(0, dx, h - Math.floor((j + 1) * h / sections[0]), h - Math.floor(j * h / sections[0])));
    for (j = 0; j < sections[1]; j++) colors.push(mean(Math.floor(j * w / sections[1]), Math.floor((j + 1) * w / sections[1]), 0, dy));
    for (j = 0; j < sections[2]; j++) colors.push(mean(w - dx, w, Math.floor(j * h / sections[2]), Math.floor((j + 1) * h / sections[2])));
    return { width: w, height: h, sections: sections, zones_rgb: colors };
};
