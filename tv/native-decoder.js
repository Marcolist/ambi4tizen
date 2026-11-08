'use strict';
var cp = require('child_process'), fs = require('fs');
exports.create = function (dependencies) {
    var d = dependencies || {}, child, pending, bytes = new Buffer(0), disabled = false;
    var metrics = { active: false, decoded: 0, failures: 0, last_decode_ms: null };
    function fail(reason) {
        if (disabled && !pending) return;
        metrics.failures++; metrics.active = false; disabled = true;
        if (child) { child.removeAllListeners('exit'); child.kill(); child = null; }
        bytes = new Buffer(0);
        if (pending) { var p = pending; pending = null; clearTimeout(p.timer); p.done(new Error(reason)); }
    }
    function start() {
        var file = d.worker || __dirname + '/native/ambi-jpeg';
        if (!d.spawn && process.arch === 'arm' && !/\bneon\b/.test(fs.readFileSync('/proc/cpuinfo', 'utf8'))) throw new Error('native_requires_neon');
        if (!d.spawn) fs.chmodSync(file, 448);
        child = (d.spawn || cp.spawn)(file, [], { stdio: ['pipe', 'pipe', 'ignore'] });
        child.on('error', function () { fail('native_spawn'); });
        child.on('exit', function () { fail('native_exit'); });
        child.stdin.on('error', function () { fail('native_stdin'); });
        child.stdout.on('data', function (data) {
            if (!pending || bytes.length + data.length > 32 + 960 * 540 * 3) return fail('native_response_bound');
            bytes = Buffer.concat([bytes, data]);
            if (bytes.length < 32) return;
            if (bytes.toString('ascii', 0, 4) !== 'AJP1') return fail('native_magic');
            var status = bytes.readUInt32BE(4), w = bytes.readUInt32BE(8), h = bytes.readUInt32BE(12);
            var sw = bytes.readUInt32BE(16), sh = bytes.readUInt32BE(20), us = bytes.readUInt32BE(24), n = bytes.readUInt32BE(28);
            if (status) {
                if (n || bytes.length !== 32) return fail('native_error_frame');
                var bad = pending; pending = null; clearTimeout(bad.timer); bytes = new Buffer(0);
                return bad.done(new Error('native_jpeg_rejected'));
            }
            if (w < 24 || h < 24 || w > 960 || h > 540 || sw < w || sh < h || sw > 960 || sh > 540 || n !== w * h * 3) return fail('native_dimensions');
            if (bytes.length < 32 + n) return;
            if (bytes.length !== 32 + n) return fail('native_trailing_data');
            var item = pending; pending = null; clearTimeout(item.timer);
            var image = { width: w, height: h, source_width: sw, source_height: sh, data: bytes.slice(32), decode_ms: us / 1000 };
            bytes = new Buffer(0); metrics.active = true; metrics.decoded++; metrics.last_decode_ms = image.decode_ms;
            item.done(null, image);
        });
    }
    return {
        decode: function (jpeg, scale, done) {
            if (disabled || pending) return done(new Error(disabled ? 'native_disabled' : 'native_busy'));
            if (jpeg.length < 4 || jpeg.length > 2097152 || [1,2,4,8].indexOf(scale) === -1) return done(new Error('native_input'));
            try {
                if (!child) start();
                pending = { done: done, timer: setTimeout(function () { fail('native_timeout'); }, 2000) };
                var header = new Buffer(8); header.writeUInt32BE(jpeg.length, 0); header.writeUInt32BE(scale, 4);
                child.stdin.write(header); child.stdin.write(jpeg);
            } catch (e) { if (pending) fail('native_start'); else { disabled = true; metrics.failures++; done(e); } }
        },
        close: function () {
            disabled = true; metrics.active = false;
            if (child) { child.removeAllListeners('exit'); child.kill(); child = null; }
            bytes = new Buffer(0);
            if (pending) { var p = pending; pending = null; clearTimeout(p.timer); p.done(new Error('native_stopped')); }
        },
        stats: function () {
            var copy = JSON.parse(JSON.stringify(metrics));
            if (child && child.pid) {
                try {
                    var match = /^VmRSS:\s+(\d+)\s+kB/m.exec(fs.readFileSync('/proc/' + child.pid + '/status', 'utf8'));
                    if (match) copy.worker_rss_bytes = Number(match[1]) * 1024;
                } catch (e) { copy.worker_rss_bytes = null; }
            }
            return copy;
        }
    };
};
