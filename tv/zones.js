'use strict';
var layouts = { 6: [2, 2, 2], 12: [3, 6, 3], 18: [5, 8, 5], 24: [6, 12, 6] };
exports.layout = function (count) {
    if (!layouts[count]) throw new Error('zones must be 6, 12, 18 or 24');
    return layouts[count].slice();
};
function validImage(image) {
    if (image.width < 24 || image.height < 24 || image.data.length !== image.width * image.height * 3) throw new Error('invalid decoded image');
}
function fullRect(image) { return { x: 0, y: 0, width: image.width, height: image.height }; }
function rowFraction(image, y, threshold) {
    var lit = 0, total = 0, step = Math.max(1, Math.floor(image.width / 96));
    for (var x = 0; x < image.width; x += step) {
        var p = (y * image.width + x) * 3;
        if (Math.max(image.data[p], image.data[p + 1], image.data[p + 2]) > threshold) lit++;
        total++;
    }
    return lit / total;
}
// Paired, nearly equal horizontal bars only. A dark scene alone is not a crop.
function detectLetterbox(image) {
    var h = image.height, limit = Math.floor(h * .24), top = 0, bottom = 0;
    while (top < limit && rowFraction(image, top, 16) <= .02) top++;
    while (bottom < limit && rowFraction(image, h - 1 - bottom, 16) <= .02) bottom++;
    if (top < Math.max(2, Math.floor(h * .025)) || bottom < Math.max(2, Math.floor(h * .025)) || top === limit || bottom === limit ||
        Math.abs(top - bottom) > Math.max(2, Math.floor(h * .02))) return null;
    var inset = Math.min(top, bottom), visible = false;
    for (var y = inset; y < Math.min(h - inset, inset + Math.max(3, Math.ceil(h * .02))); y++) {
        if (rowFraction(image, y, 24) >= .1) visible = true;
    }
    if (!visible) return null;
    // One pixel inside the detected edge avoids JPEG ringing at the black seam.
    inset++;
    return { x: 0, y: inset, width: image.width, height: h - 2 * inset };
}
function sameRect(a, b) { return a && b && a.width === b.width && Math.abs(a.y - b.y) <= 2 && Math.abs(a.height - b.height) <= 4; }
function summarize(image, count, depth, rect) {
    var sections = exports.layout(count), w = image.width, h = image.height, data = image.data;
    if (typeof depth !== 'number' || !isFinite(depth) || depth < 0.02 || depth > 0.25) throw new Error('invalid edge depth');
    validImage(image);
    var height = rect.height, y0 = rect.y;
    var dx = Math.max(1, Math.floor(w * depth)), dy = Math.max(1, Math.floor(height * depth)), colors = [];
    function mean(x0, x1, y0, y1) {
        var sum = [0, 0, 0], n = 0;
        for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) {
            var p = (y * w + x) * 3;
            sum[0] += data[p]; sum[1] += data[p + 1]; sum[2] += data[p + 2]; n++;
        }
        return sum.map(function (v) { return Math.round(v / n); });
    }
    var j;
    for (j = 0; j < sections[0]; j++) colors.push(mean(0, dx, y0 + height - Math.floor((j + 1) * height / sections[0]), y0 + height - Math.floor(j * height / sections[0])));
    for (j = 0; j < sections[1]; j++) colors.push(mean(Math.floor(j * w / sections[1]), Math.floor((j + 1) * w / sections[1]), y0, y0 + dy));
    for (j = 0; j < sections[2]; j++) colors.push(mean(w - dx, w, y0 + Math.floor(j * height / sections[2]), y0 + Math.floor((j + 1) * height / sections[2])));
    return { width: w, height: h, sections: sections, zones_rgb: colors, sample_rect: rect, letterbox: rect.y > 0 };
}
exports.summarize = function (image, count, depth) {
    validImage(image);
    return summarize(image, count, depth, detectLetterbox(image) || fullRect(image));
};
exports.createSampler = function (count, depth) {
    var active, pending, confirmations = 0, clearFrames = 0, width, height;
    return function (image) {
        validImage(image);
        if (width !== image.width || height !== image.height) {
            width = image.width; height = image.height; active = fullRect(image); pending = null; confirmations = 0; clearFrames = 0;
        }
        var candidate = detectLetterbox(image);
        if (candidate) {
            clearFrames = 0;
            if (sameRect(active, candidate)) { pending = null; confirmations = 0; }
            else {
                confirmations = sameRect(pending, candidate) ? confirmations + 1 : 1; pending = candidate;
                if (confirmations >= 2) { active = candidate; pending = null; confirmations = 0; }
            }
        } else {
            pending = null; confirmations = 0;
            // Keep the crop through black fades and subtitles in an existing bar.
            clearFrames = rowFraction(image, 1, 24) > .5 && rowFraction(image, height - 2, 24) > .5 ? clearFrames + 1 : 0;
            if (clearFrames >= 3) { active = fullRect(image); clearFrames = 0; }
        }
        return summarize(image, count, depth, active);
    };
};
