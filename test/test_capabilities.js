'use strict';
var assert = require('assert'), fs = require('fs'), vm = require('vm');
function run(writeDenied, synchronous) {
    var created = false, removed = false, calls = 0, result, module = { exports: {} };
    var fakeFs = {
        readFileSync: function (path) { return path === '/proc/cpuinfo' ? 'Features: neon' : new Buffer([127,69,76,70]); },
        statSync: function (path) { return { mode: 420,
            isSocket: function () { return false; }, isDirectory: function () { return path === '/fixture/res/wgt/../../data'; } }; },
        chmodSync: function () { var error = new Error('read only'); error.code = 'EACCES'; throw error; },
        writeFileSync: function (path, data, opts) {
            assert.strictEqual(opts.flag, 'wx'); assert.strictEqual(opts.mode, 448);
            assert(path.indexOf('/fixture/res/wgt/../../data/ambi-jpeg-preflight-') === 0);
            if (writeDenied) throw new Error('own data not writable'); created = true;
        },
        unlinkSync: function () { assert(created); removed = true; }
    };
    vm.runInNewContext(fs.readFileSync('tv/capabilities.js', 'utf8'), {
        module: module, exports: module.exports, __dirname: '/fixture/res/wgt',
        process: { version: 'v4.4.3', arch: 'arm', execPath: '/usr/bin/node', env: {}, pid: 123 },
        setTimeout: setTimeout, clearTimeout: clearTimeout,
        require: function (name) {
            if (name === 'fs') return fakeFs;
            if (name === 'child_process') return { execFile: function (path, args, opts, done) {
                calls++; assert.strictEqual(args[0], '--self-test');
                if (synchronous && calls === 1) throw new Error('spawn EACCES');
                done({ code: 'Error: spawn EACCES' }, '', 'execution denied');
            } };
            return { systemAddress: function () { return 'unix:path=/missing'; }, createClient: function () { throw new Error('no socket'); } };
        }
    });
    module.exports.inspect(function (data) { assert(!result); result = data; });
    assert(result.native_error); assert(result.native_private_error); assert(result.dbus_error);
    assert(!result.native && !result.native_private); assert.strictEqual(created, !writeDenied);
    assert.strictEqual(removed, !writeDenied); assert.strictEqual(calls, writeDenied ? 1 : 2);
}
run(false); run(true); run(false, true); run(true, true);
console.log('PASS capabilities: Tizen-style EACCES, exclusive own-data staging, cleanup and denied-write handling');
