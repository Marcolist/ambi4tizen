/* ES5, temporary diagnostics only. No arbitrary commands or code loading. */
'use strict';
var ACCESS = /*__LOCAL_CONFIG__*/null;
var server, expiry;

module.exports.onStart = function () {
    if (!ACCESS) return;
    var fs = require('fs');
    var http = require('http');
    var cp = require('child_process');
    var paths = ['/usr/bin/dbus-send', '/bin/dbus-send', '/usr/bin/gdbus', '/bin/gdbus'];

    function send(res, code, body) {
        var text = typeof body === 'string' ? body : JSON.stringify(body);
        res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' });
        res.end(text);
    }

    server = http.createServer(function (req, res) {
        var peer = req.connection.remoteAddress.replace(/^::ffff:/, '');
        if (peer !== ACCESS.host || req.headers.authorization !== 'Bearer ' + ACCESS.token) return send(res, 403, 'Denied');
        if (req.method === 'POST' && req.url === '/stop') {
            send(res, 200, 'Stopping');
            server.close(function () { process.exit(0); }); clearTimeout(expiry);
            return;
        }
        if (req.method === 'POST' && req.url === '/capture') {
            require('./capture').once(function (result) { send(res, 200, result); });
            return;
        }
        if (req.method !== 'GET') return send(res, 405, 'Method not allowed');
        if (req.url === '/status') {
            var binaries = {};
            paths.forEach(function (p) { try { binaries[p] = fs.statSync(p).size; } catch (e) { binaries[p] = e.code; } });
            var label;
            try { label = fs.readFileSync('/proc/self/attr/current', 'utf8'); } catch (e) { label = e.code; }
            return send(res, 200, { version: '0.1.5', capture: 'single-request, maximum 12 per launch', node: process.version, binaries: binaries, label: label, lifetime_seconds: 300 });
        }
        if (req.url === '/metrics') return require('./system-info').metrics(function (result) { send(res, 200, result); });
        if (req.url === '/broker-info') {
            var binary = fs.existsSync(paths[0]) ? paths[0] : (fs.existsSync(paths[1]) ? paths[1] : null);
            if (!binary) return send(res, 200, 'No dbus-send executable in checked system paths');
            var args = ['--system', '--print-reply', '--reply-timeout=1500', '--dest=samsung.tizen.dcapture', '/samsung/tizen/dcapture', 'org.freedesktop.DBus.Introspectable.Introspect'];
            cp.execFile(binary, args, { timeout: 2500, maxBuffer: 65536 }, function (err, stdout, stderr) {
                send(res, 200, { error: err ? String(err) : null, stdout: stdout, stderr: stderr });
            });
            return;
        }
        send(res, 404, 'Not found');
    });
    server.timeout = 10000;
    server.listen(18792, '0.0.0.0');
    expiry = setTimeout(function () { server.close(function () { process.exit(0); }); }, 300000);
};

module.exports.onStop = function () {
    if (expiry) clearTimeout(expiry);
    if (server) server.close();
};
