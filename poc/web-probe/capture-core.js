'use strict';
// Shared mode-0 capture; only bounded image files owned by this instance are read.
exports.clock = function () { var t = process.hrtime(); return t[0] * 1000 + t[1] / 1000000; };
exports.createReader = function (dependencies) {
    var d = dependencies || {}, fs = d.fs || require('fs'), cp = d.cp || require('child_process');
    var clock = d.clock || exports.clock, active = false, serial = 0, persistent;
    var stats = { process_calls: 0, persistent_calls: 0, broker_fallbacks: 0 };
    function reader(options, done) {
        var sizes = { '480x270': [480, 270], '320x180': [320, 180], '160x90': [160, 90] };
        var size = sizes[options.resolution || '480x270'], quality = options.quality === undefined ? 55 : options.quality;
        if (active || !size || quality !== Math.floor(quality) || quality < 20 || quality > 90)
            return done({ status: 'limited', error: active ? 'busy' : 'capture_options' });
        active = true;
        var started = clock(), mark = started, profile = {}, backend = 'process';
        var basename = 'ambi-probe-' + process.pid + '-' + Date.now() + '-' + (++serial), expected = '/dev/shm/' + basename;
        var args = ['--system', '--print-reply', '--reply-timeout=3000', '--dest=samsung.tizen.dcapture', '/samsung/tizen/dcapture',
            'samsung.tizen.dcapture.RequestCaptureToFileSync', 'int32:0', 'int32:0', 'int32:1',
            'int32:' + size[0], 'int32:' + size[1], 'int32:' + quality, 'string:/dev/shm', 'string:' + basename];
        function step(name) { var now = clock(); profile[name] = now - mark; mark = now; }
        function completed(err, stdout, values) {
            var result = { status: 'error', started_ms: started, profile_ms: profile, quality: quality, broker_backend: backend };
            step('broker');
            try {
                if (err) throw new Error('Broker request failed');
                var ints = [], paths = [], match;
                if (values) { ints = values.slice(0, 3); paths = values.slice(3); }
                else {
                    var re = /int32\s+(-?\d+)/g, pathRe = /string\s+"([^"\r\n]*)"/g;
                    while ((match = re.exec(stdout))) ints.push(Number(match[1]));
                    while ((match = pathRe.exec(stdout))) paths.push(match[1]);
                }
                result.broker = { code: ints[0], width: ints[1], height: ints[2] };
                if (ints.length !== 3 || paths.length !== 1 || ints[0] !== 0) throw new Error('Unexpected broker reply');
                var path = paths[0];
                if (path !== expected && path !== expected + '.jpg') throw new Error('Unexpected capture path');
                if (ints[1] < 1 || ints[2] < 1 || ints[1] > 960 || ints[2] > 540) throw new Error('Unexpected dimensions');
                var stat = fs.lstatSync(path);
                if (!stat.isFile() || stat.size < 4 || stat.size > 2097152) throw new Error('Invalid JPEG');
                result.jpeg = fs.readFileSync(path); result.jpeg_bytes = result.jpeg.length; step('read'); result.status = 'ok';
            } catch (e) { result.error = String(e); }
            finally {
                result.temporary_file_removed = true;
                [expected, expected + '.jpg'].forEach(function (path) {
                    try { fs.unlinkSync(path); }
                    catch (e) { if (e.code !== 'ENOENT') { result.temporary_file_removed = false; result.cleanup_error = String(e); } }
                });
                step('cleanup'); active = false;
            }
            result.elapsed_ms = clock() - started; done(result);
        }
        function processCall() {
            backend = 'process'; stats.process_calls++;
            try { cp.execFile('/usr/bin/dbus-send', args, { timeout: 4000, maxBuffer: 16384 }, completed); }
            catch (e) { completed(e, ''); }
        }
        if (options.broker === 'persistent' || options.broker === 'auto') {
            try {
                if (!persistent) persistent = (d.persistent || require('./persistent-broker').create)();
                backend = 'persistent'; stats.persistent_calls++;
                persistent.call({ width: size[0], height: size[1], quality: quality, basename: basename }, function (err, values) {
                    // Never repeat an outstanding/timed-out capture. Retry only before a call could reach the broker.
                    if (err && err.retrySafe && options.broker === 'auto') { stats.broker_fallbacks++; return processCall(); }
                    completed(err, '', values);
                });
            } catch (e) { if (options.broker === 'auto') { stats.broker_fallbacks++; processCall(); } else completed(e, ''); }
        } else processCall();
    }
    reader.busy = function () { return active; };
    reader.close = function () { if (persistent) persistent.close(); };
    reader.stats = function () { var copy = JSON.parse(JSON.stringify(stats)); if (persistent) copy.persistent = persistent.stats(); return copy; };
    return reader;
};
exports.create = function (dependencies) {
    var d = dependencies || {}, clock = d.clock || exports.clock, reader = d.reader || exports.createReader(d);
    var decode = d.decode || require('./vendor/jpeg-decoder'), native, busy = false, ready, prefetching = false, waiting;
    var stopped = false, lastWork = 0, metrics = { native_fallbacks: 0, prefetched: 0, discarded: 0 };
    function prefetch(options, result) {
        if (stopped || !options.pipeline || prefetching || ready) return;
        // At a slow cadence, early prefetch would make the next image older.
        if ((options.interval_ms || 0) > (result.elapsed_ms || 0) + lastWork) return;
        prefetching = true; metrics.prefetched++;
        reader(options, function (result) {
            prefetching = false;
            if (stopped) { metrics.discarded++; if (waiting) { var abandoned = waiting; waiting = null; abandoned(result); } return; }
            if (waiting) { var cb = waiting; waiting = null; cb(result); }
            else ready = result;
        });
    }
    function capture(options, summarize, done) {
        if (busy) return done({ status: 'limited', error: 'busy' });
        busy = true;
        function consume(result) {
            if (stopped) { delete result.jpeg; busy = false; result.status = 'error'; result.error = 'stopped'; return done(result); }
            if (result.status !== 'ok' || !result.temporary_file_removed) { delete result.jpeg; busy = false; return done(result); }
            var jpeg = result.jpeg; delete result.jpeg;
            prefetch(options, result);
            var decodeStart = clock();
            function finish(err, image, backend) {
                result.profile_ms.decode = clock() - decodeStart; result.decoder_backend = backend;
                try {
                    if (err) throw err;
                    var sw = image.source_width || image.width, sh = image.source_height || image.height;
                    if (sw !== result.broker.width || sh !== result.broker.height) throw new Error('JPEG dimensions disagree with broker');
                    result.source_width = sw; result.source_height = sh;
                    if (image.decode_ms !== undefined) result.native_decode_ms = image.decode_ms;
                    var now = clock(); result.colors = summarize(image); result.profile_ms.zones = clock() - now;
                    now = clock();
                    if (options.hash) result.jpeg_sha256 = require('crypto').createHash('sha256').update(jpeg).digest('hex');
                    result.profile_ms.hash = clock() - now; result.status = 'ok';
                } catch (e) { result.status = 'error'; result.error = String(e); }
                lastWork = clock() - decodeStart;
                result.elapsed_ms = clock() - result.started_ms; busy = false; done(result);
            }
            function javascript() {
                var image;
                try { image = decode(jpeg, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 1, maxMemoryUsageInMB: 24 }); }
                catch (e) { return finish(e, null, 'js'); }
                finish(null, image, 'js');
            }
            if (options.decoder === 'native' || options.decoder === 'auto') {
                try {
                    if (!native) native = (d.native || require('./native-decoder').create)();
                    native.decode(jpeg, options.decode_scale || 1, function (err, image) {
                        if (err && options.decoder === 'auto') { metrics.native_fallbacks++; return javascript(); }
                        finish(err, image, 'native');
                    });
                } catch (e) { if (options.decoder === 'auto') { metrics.native_fallbacks++; javascript(); } else finish(e, null, 'native'); }
            } else javascript();
        }
        if (ready) { var result = ready; ready = null; consume(result); }
        else if (prefetching) waiting = consume;
        else reader(options, consume);
    }
    capture.busy = function () { return busy || prefetching; };
    capture.start = function () { stopped = false; };
    capture.stop = function () { stopped = true; if (ready) { ready = null; metrics.discarded++; } };
    capture.close = function () { capture.stop(); reader.close(); if (native) native.close(); };
    capture.stats = function () { var copy = JSON.parse(JSON.stringify(metrics)); copy.reader = reader.stats(); if (native) copy.native = native.stats(); return copy; };
    return capture;
};
