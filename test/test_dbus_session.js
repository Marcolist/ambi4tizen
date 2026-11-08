'use strict';
// A private session bus and a synthetic fixed-method service. Never the system bus.
var assert = require('assert'), path = require('path'), fs = require('fs');
var root = path.resolve('.local/tv-node/node_modules/dbus-native');
if (!process.env.DBUS_SESSION_BUS_ADDRESS || !fs.existsSync(root)) { console.log('SKIP private D-Bus test: optional dependencies/session missing'); process.exit(0); }
var dbus = require(root), address = process.env.DBUS_SESSION_BUS_ADDRESS, calls = 0, connections = 0, serial = 3;
var service = dbus.createConnection({ busAddress: address, authMethods: ['EXTERNAL'] });
var timeout = setTimeout(function () { throw new Error('private D-Bus test timeout'); }, 5000);
service.on('error', function (e) { throw e; });
service.on('connect', function () {
    service.message({ type: 1, serial: 1, destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus', member: 'Hello' });
});
service.on('message', function (msg) {
    if (msg.type === 3) throw new Error('private service D-Bus error');
    if (msg.replySerial === 1) {
        service.message({ type: 1, serial: 2, destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus', member: 'RequestName', signature: 'su', body: ['samsung.tizen.dcapture', 0] });
    } else if (msg.replySerial === 2) run();
    else if (msg.type === 1 && msg.member === 'RequestCaptureToFileSync') {
        var args = msg.body;
        assert.deepEqual(args.slice(0, 3), [0,0,1]); assert.strictEqual(args[5], 35);
        assert.strictEqual(args[6], '/dev/shm'); calls++;
        service.message({ type: 2, serial: serial++, replySerial: msg.serial, destination: msg.sender,
            signature: 'iiis', body: [0, args[3], args[4], args[6] + '/' + args[7] + '.jpg'] });
    }
});
function run() {
    var broker = require('../tv/persistent-broker').create({ address: address,
        client: function (opts) { connections++; return require('../tv/fixed-dbus').createClient(opts); } });
    function next() {
        broker.call({ width: 160, height: 90, quality: 35, basename: 'synthetic-' + calls }, function (bad, values) {
            assert.ifError(bad); assert.deepEqual(values.slice(0, 3), [0,160,90]);
            if (calls < 5) return next();
            assert.strictEqual(connections, 1); assert(broker.stats().connected);
            broker.close(); service.stream.destroy(); clearTimeout(timeout);
            console.log('PASS persistent D-Bus: five fixed mode-0 calls over one EXTERNAL-authenticated connection');
        });
    }
    next();
}
