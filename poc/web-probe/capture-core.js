'use strict';
// Shared normal capture request; injectable I/O for tests, never a command interface.
exports.clock = function () { var t = process.hrtime(); return t[0] * 1000 + t[1] / 1000000; };
exports.create = function (dependencies) {
    var d = dependencies || {}, fs = d.fs || require('fs'), cp = d.cp || require('child_process');
    var decode = d.decode || require('./vendor/jpeg-decoder'), clock = d.clock || exports.clock;
    var busy = false, serial = 0;
    return function (options, summarize, done) {
        var sizes = { '480x270': [480, 270], '320x180': [320, 180], '160x90': [160, 90] };
        var size = sizes[options.resolution || '480x270'];
        if (busy || !size) return done({ status: 'limited', error: busy ? 'busy' : 'resolution' });
        busy = true;
        var started = clock(), mark = started, profile = {};
        var basename = 'ambi-probe-' + process.pid + '-' + Date.now() + '-' + (++serial);
        var expected = '/dev/shm/' + basename;
        var args = ['--system', '--print-reply', '--reply-timeout=3000',
            '--dest=samsung.tizen.dcapture', '/samsung/tizen/dcapture',
            'samsung.tizen.dcapture.RequestCaptureToFileSync',
            'int32:0', 'int32:0', 'int32:1', 'int32:' + size[0], 'int32:' + size[1], 'int32:55',
            'string:/dev/shm', 'string:' + basename];
        function step(name) { var now = clock(); profile[name] = now - mark; mark = now; }
        function completed(err, stdout) {
            var result = { status: 'error', started_ms: started, profile_ms: profile };
            step('broker');
            try {
                if (err) throw new Error('Broker request failed');
                var ints = [], match, re = /int32\s+(-?\d+)/g;
                while ((match = re.exec(stdout))) ints.push(Number(match[1]));
                var paths = [], pathRe = /string\s+"([^"\r\n]*)"/g;
                while ((match = pathRe.exec(stdout))) paths.push(match[1]);
                result.broker = { code: ints[0], width: ints[1], height: ints[2] };
                if (ints.length !== 3 || paths.length !== 1 || ints[0] !== 0) throw new Error('Unexpected broker reply');
                var path = paths[0];
                if (path !== expected && path !== expected + '.jpg') throw new Error('Unexpected capture path');
                if (ints[1] < 1 || ints[2] < 1 || ints[1] > 960 || ints[2] > 540) throw new Error('Unexpected dimensions');
                var stat = fs.lstatSync(path);
                if (!stat.isFile() || stat.size < 4 || stat.size > 2097152) throw new Error('Invalid JPEG');
                var jpeg = fs.readFileSync(path); step('read');
                var image = decode(jpeg, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 1, maxMemoryUsageInMB: 24 });
                step('decode');
                if (image.width !== ints[1] || image.height !== ints[2]) throw new Error('JPEG dimensions disagree with broker');
                result.colors = summarize(image); step('zones');
                if (options.hash) result.jpeg_sha256 = require('crypto').createHash('sha256').update(jpeg).digest('hex');
                step('hash'); result.status = 'ok';
            } catch (e) { result.error = String(e); }
            finally {
                result.temporary_file_removed = true;
                [expected, expected + '.jpg'].forEach(function (path) {
                    try { fs.unlinkSync(path); }
                    catch (e) { if (e.code !== 'ENOENT') { result.temporary_file_removed = false; result.cleanup_error = String(e); } }
                });
                step('cleanup'); busy = false;
            }
            result.elapsed_ms = clock() - started; done(result);
        }
        try { cp.execFile('/usr/bin/dbus-send', args, { timeout: 4000, maxBuffer: 16384 }, completed); }
        catch (e) { completed(e, ''); }
    };
};
