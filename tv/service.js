'use strict';
var CONFIG = /*__SENDER_CONFIG__*/null;
var sender, server, expiry, ending = false;
function shutdown() {
    if (ending) return; ending = true;
    if (expiry) clearTimeout(expiry);
    if (sender) sender.stop();
    function drained() {
        if (sender && sender.busy()) return setTimeout(drained, 100);
        if (sender) sender.close();
        if (server) server.close(function () { process.exit(0); });
        else process.exit(0);
    }
    drained();
}
module.exports.onStart = function () {
    if (!CONFIG || !CONFIG.enabled || sender || ending) return;
    sender = require('./sender').create(CONFIG);
    server = require('http').createServer(function (req, res) {
        var peer = req.connection.remoteAddress.replace(/^::ffff:/, '');
        function reply(code, data) {
            res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Connection': 'close' });
            res.end(JSON.stringify(data));
        }
        if (peer !== CONFIG.developer_ip || req.headers.authorization !== 'Bearer ' + CONFIG.diagnostic_token) return reply(403, { error: 'denied' });
        if (req.method === 'GET' && req.url === '/status') return reply(200, sender.metrics());
        if (req.method === 'POST' && req.url === '/stop') { reply(200, { stopping: true }); return shutdown(); }
        reply(404, { error: 'not found' });
    });
    server.timeout = 2000;
    server.on('error', shutdown);
    server.listen(18793, '0.0.0.0');
    try { sender.start(); } catch (e) { shutdown(); return; }
    // Leave a short diagnostics window after the bounded capture run.
    if (CONFIG.duration_ms !== 0) expiry = setTimeout(shutdown, CONFIG.duration_ms + 5000);
};
module.exports.onStop = function () {
    if (expiry) clearTimeout(expiry);
    if (sender) sender.stop();
    if (server) server.close();
};
