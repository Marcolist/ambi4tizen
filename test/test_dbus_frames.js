'use strict';
// Synthetic Unix peer only; no system bus or TV access.
var assert = require('assert'), net = require('net'), fs = require('fs'), os = require('os');
var create = require('../tv/fixed-dbus').createClient;
var directory = os.tmpdir() + '/ambi-dbus-' + process.pid + '-' + Date.now(); fs.mkdirSync(directory);
var modes = ['fragmented', 'auth_rejected', 'oversized', 'bad_protocol', 'bad_variant', 'truncated_body'];
function zeros(n) { var b = new Buffer(n); b.fill(0); return b; }
function hello() {
    var b = zeros(46);
    b[0] = 108; b[1] = 2; b[3] = 1; b.writeUInt32LE(6, 4); b.writeUInt32LE(1, 8); b.writeUInt32LE(15, 12);
    b[16] = 5; b[17] = 1; b[18] = 117; b.writeUInt32LE(1, 20);
    b[24] = 8; b[25] = 1; b[26] = 103; b[28] = 1; b[29] = 115;
    // Header ends at 31, padded to 32; body is a string ':1.9'.
    b = b.slice(0, 41); b.writeUInt32LE(9, 4); b.writeUInt32LE(4, 32); b.write(':1.9', 36, 'ascii');
    return b;
}
var deadline = setTimeout(function () { throw new Error('D-Bus frame test timeout'); }, 5000);
function next() {
    if (!modes.length) { fs.rmdirSync(directory); clearTimeout(deadline); console.log('PASS fixed D-Bus: fragmented reply, rejected auth, bounds, protocol and malformed-frame errors'); return; }
    var mode = modes.shift(), socketPath = directory + '/bus', peer, complete = false, client;
    var server = net.createServer(function (socket) {
        peer = socket; var received = '', authenticated = false;
        socket.on('error', function () {});
        socket.on('data', function (data) {
            received += data.toString('ascii');
            if (!authenticated && received.indexOf('\r\n') >= 0) {
                assert(received.indexOf('\0AUTH EXTERNAL ') === 0); authenticated = true;
                if (mode === 'auth_rejected') return socket.write('REJECTED EXTERNAL\r\n');
                socket.write('OK 0123456789abcdef\r\n');
            }
            if (received.indexOf('BEGIN\r\n') < 0 || complete) return;
            complete = true; var reply = hello();
            if (mode === 'oversized') reply.writeUInt32LE(65537, 4);
            if (mode === 'bad_protocol') reply[3] = 2;
            if (mode === 'bad_variant') reply[18] = 118;
            if (mode === 'truncated_body') reply.writeUInt32LE(100, 32);
            socket.write(reply.slice(0, 7)); setImmediate(function () { if (!socket.destroyed) socket.write(reply.slice(7)); });
        });
    });
    function cleanup() { client.connection.stream.destroy(); if (peer) peer.destroy(); server.close(next); }
    server.listen(socketPath, function () {
        client = create({ busAddress: 'unix:path=' + socketPath });
        client.connection.on('error', function () { assert.notStrictEqual(mode, 'fragmented'); cleanup(); });
        client.invokeDbus({ member: 'Hello' }, function (err, name) {
            assert.strictEqual(mode, 'fragmented'); assert.ifError(err); assert.strictEqual(name, ':1.9'); cleanup();
        });
    });
}
next();
