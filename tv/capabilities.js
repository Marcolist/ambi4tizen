'use strict';
// Fixed, authenticated preflight only. No arbitrary command/path interface.
var fs = require('fs'), cp = require('child_process');
exports.inspect = function (done) {
    var result = { node: process.version, arch: process.arch, exec_path: process.execPath,
        raw_capture: { available: false, reason: 'No verified raw RGB interface in the normal application context; JPEG route retained' } }, left = 2;
    function finish() { if (--left === 0) done(result); }
    try { result.neon = /\bneon\b/.test(fs.readFileSync('/proc/cpuinfo', 'utf8')); } catch (e) { result.neon = null; }
    result.bus_environment = {};
    ['DBUS_SYSTEM_BUS_ADDRESS', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'].forEach(function (key) {
        if (process.env[key]) result.bus_environment[key] = process.env[key];
    });
    result.bus_sockets = {};
    ['/run/dbus/system_bus_socket', '/var/run/dbus/system_bus_socket', '/opt/var/run/dbus/system_bus_socket'].forEach(function (path) {
        try { result.bus_sockets[path] = fs.statSync(path).isSocket(); } catch (e) { result.bus_sockets[path] = e.code; }
    });
    var worker = __dirname + '/native/ambi-jpeg';
    try { result.worker_mode = fs.statSync(worker).mode & 511; } catch (e) {}
    try { fs.chmodSync(worker, 448); } catch (e) { result.worker_chmod = e.code; }
    function privateWorkerTest() {
        var paths = [__dirname + '/../../data', '/home/owner/apps_rw/ambiSend40/data', '/opt/usr/home/owner/apps_rw/ambiSend40/data'];
        var file, created = false;
        try {
            for (var i = 0; i < paths.length; i++) {
                try { if (fs.statSync(paths[i]).isDirectory()) { file = paths[i] + '/ambi-jpeg-preflight-' + process.pid + '-' + Date.now(); break; } } catch (e) {}
            }
            if (!file) { result.native_private_error = 'own_data_directory_unavailable'; return finish(); }
            var binary = fs.readFileSync(worker);
            if (binary.length > 2097152) throw new Error('worker_size');
            fs.writeFileSync(file, binary, { flag: 'wx', mode: 448 }); created = true;
            cp.execFile(file, ['--self-test'], { timeout: 2500, maxBuffer: 2048 }, function (err, stdout, stderr) {
                try { fs.unlinkSync(file); result.native_private_cleaned = true; } catch (e) { result.native_private_cleanup = e.code; }
                if (err) { result.native_private_error = err.code || String(err).slice(0, 100); result.native_private_detail = String(stderr || '').slice(-500); }
                else { try { result.native_private = JSON.parse(stdout); } catch (e) { result.native_private_error = 'invalid_self_test'; } }
                finish();
            });
        } catch (e) {
            result.native_private_error = String(e).slice(0, 120);
            if (created) { try { fs.unlinkSync(file); result.native_private_cleaned = true; } catch (ignored) {} }
            finish();
        }
    }
    try { cp.execFile(worker, ['--self-test'], { timeout: 2500, maxBuffer: 2048 }, function (err, stdout) {
        if (err) result.native_error = err.code || String(err).slice(0, 100);
        else { try { result.native = JSON.parse(stdout); } catch (e) { result.native_error = 'invalid_self_test'; } }
        if (err) return privateWorkerTest();
        finish();
    }); } catch (e) { result.native_error = String(e).slice(0, 160); privateWorkerTest(); }
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
        bus = require('./fixed-dbus').createClient({ busAddress: require('./fixed-dbus').systemAddress() });
        bus.connection.on('error', busDone);
        bus.connection.on('end', function () { busDone('connection_closed'); });
        timer = setTimeout(function () { busDone('timeout'); }, 2500);
        bus.invokeDbus({ member: 'Hello' }, function (err) {
            if (err) return busDone(err);
            bus.invoke({ destination: 'samsung.tizen.dcapture', path: '/samsung/tizen/dcapture',
                interface: 'org.freedesktop.DBus.Introspectable', member: 'Introspect' }, busDone);
        });
    } catch (e) { busDone(e); }
};
