'use strict';
// Real sender + real JPEG decoder + real UDP; only the TV broker/file boundary is simulated.
var fs = require('fs'), core = require('../poc/web-probe/capture-core'), fixture = fs.readFileSync('test/output/fixture.jpg');
var files = {};
var capture = core.create({ fs: {
    lstatSync: function (p) { return { isFile: function () { return true; }, size: files[p].length }; },
    readFileSync: function (p) { return files[p]; },
    unlinkSync: function (p) { if (!files[p]) { var e = new Error('missing'); e.code = 'ENOENT'; throw e; } delete files[p]; }
}, cp: { execFile: function (bin, args, options, cb) {
    var path = '/dev/shm/' + args[13].slice(7) + '.jpg'; files[path] = fixture;
    setTimeout(function () { cb(null, 'int32 0\nint32 160\nint32 90\nstring "' + path + '"'); }, 10);
} } });
var sender = require('../tv/sender').create({ esp_ip: '127.0.0.1', port: Number(process.argv[2]),
    key_hex: fs.readFileSync(process.argv[3], 'utf8').trim(), zones: 12, resolution: '160x90', edge_depth: .1,
    interval_ms: 500, duration_ms: 1200, brightness: 255 }, { capture: capture });
sender.start();setTimeout(function () { sender.close();console.log(JSON.stringify(sender.metrics())); }, 1400);
