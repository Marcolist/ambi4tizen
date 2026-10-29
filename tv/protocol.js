'use strict';
var crypto = require('crypto');
function integer(v, max) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= max && Math.floor(v) === v; }
exports.encode = function (frame, key) {
    var colors = frame.colors, sections = frame.sections;
    if (!Buffer.isBuffer(key) || key.length !== 32 || !key.some(function (v) { return v !== 0; })) throw new Error('32 byte key required');
    if (!Buffer.isBuffer(frame.session) || frame.session.length !== 8 || !frame.session.some(function (v) { return v !== 0; })) throw new Error('session');
    if (!Array.isArray(colors) || colors.length < 3 || colors.length > 24 || !Array.isArray(sections) || sections.length !== 3 ||
        !sections.every(function (n) { return integer(n, 24) && n > 0; }) || sections[0] + sections[1] + sections[2] !== colors.length ||
        !integer(frame.sequence, 4294967295) || !integer(frame.capture_ms, 4294967295) || !integer(frame.age_ms, 65535) ||
        (frame.brightness !== undefined && !integer(frame.brightness, 255))) throw new Error('invalid frame');
    var data = new Buffer(32 + 3 * colors.length); data.fill(0); data.write('AMB1', 0, 'ascii');
    data[4] = 1; data[5] = frame.brightness === undefined ? 0 : 1; data.writeUInt16BE(colors.length, 6);
    frame.session.copy(data, 8); data.writeUInt32BE(frame.sequence, 16); data.writeUInt32BE(frame.capture_ms, 20);
    data.writeUInt16BE(frame.age_ms, 24); data[26] = frame.brightness === undefined ? 255 : frame.brightness;
    data[27] = sections[0]; data[28] = sections[1]; data[29] = sections[2];
    colors.forEach(function (rgb, i) {
        if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(function (v) { return integer(v, 255); })) throw new Error('RGB');
        for (var c = 0; c < 3; c++) data[32 + i * 3 + c] = rgb[c];
    });
    var tag = crypto.createHmac('sha256', key).update(data).digest().slice(0, 16);
    return Buffer.concat([data, tag]);
};
