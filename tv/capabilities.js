'use strict';
// Fixed, authenticated preflight only. No arbitrary command/path interface.
var fs = require('fs'), cp = require('child_process');
exports.inspect = function (done) {
    var result = { node: process.version, arch: process.arch, exec_path: process.execPath,
        raw_capture: { available: false, reason: 'No verified raw RGB interface in the normal application context; JPEG route retained' } }, left = 2;
    function finish() { if (--left === 0) done(result); }
    try { result.neon = /\bneon\b/.test(fs.readFileSync('/proc/cpuinfo', 'utf8')); } catch (e) { result.neon = null; }
    var worker = __dirname + '/native/ambi-jpeg';
    try { fs.chmodSync(worker, 448); } catch (e) { result.worker_chmod = e.code; }
    cp.execFile(worker, ['--self-test'], { timeout: 2500, maxBuffer: 2048 }, function (err, stdout) {
        if (err) result.native_error = err.code || String(err).slice(0, 100);
        else { try { result.native = JSON.parse(stdout); } catch (e) { result.native_error = 'invalid_self_test'; } }
        finish();
    });
    var bus, ended = false, timer;
    function busDone(error, xml) {
        if (ended) return; ended = true; clearTimeout(timer);
        if (error) result.dbus_error = String(error).slice(0, 160);
        else {
            result.persistent_dbus = true; result.capture_methods = [];
            var re = /<method name="([^"]+)"/g, match;
            while ((match = re.exec(xml))) result.capture_methods.push(match[1]);
        }
        if (bus) bus.connection.stream.destroy();
        finish();
    }
    try {
        bus = require('dbus-native').createClient({ busAddress: 'unix:path=/var/run/dbus/system_bus_socket', authMethods: ['EXTERNAL'], direct: true });
        bus.connection.on('error', function (e) { busDone(e); });
        timer = setTimeout(function () { busDone('timeout'); }, 2500);
        bus.invokeDbus({ member: 'Hello' }, function (err) {
            if (err) return busDone(err);
            bus.invoke({ destination: 'samsung.tizen.dcapture', path: '/samsung/tizen/dcapture',
                interface: 'org.freedesktop.DBus.Introspectable', member: 'Introspect' }, busDone);
        });
    } catch (e) { busDone(e); }
};
