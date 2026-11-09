'use strict';
// Execute the shipped entry points in a sandbox; no device, UDP or capture access.
var assert = require('assert'), fs = require('fs'), vm = require('vm');
var valid = require('../tv/catalog/receiver-config').valid;
var manifest = require('../distribution/apps2samsung/Marcolist__ambi4tizen.json');
var source = fs.readFileSync('tv/catalog/service.js', 'utf8');
var key = new Array(33).join('aB'), ip = '192.0.2.42';
function settings(address, secret) { return { esp_ip: address, key_hex: secret }; }
var badIps = ['', '0.1.2.3', '127.0.0.1', '224.0.0.1', '255.255.255.255',
    '192.0.2.0', '192.0.2.255', '192.0.2.256', '192.00.2.1', '192.0.2',
    '192.0.2.1 ', ' 192.0.2.1', '192.0.2.1:19446', 'host.local', '::1'];
var badKeys = ['', new Array(65).join('0'), new Array(65).join('g'), key.slice(1), key + 'a', key + ' '];
badIps.forEach(function (value) { assert(!valid(settings(value, key))); });
badKeys.forEach(function (value) { assert(!valid(settings(ip, value))); });
assert(valid(settings(ip, key))); assert(!valid(null)); assert(!valid(settings(123, key)));
// The installer form and service agree, including boundary octets and zero keys.
manifest.user_settings.fields.forEach(function (field) {
    var regex = new RegExp(field.pattern), good = field.key === 'esp_ip' ? ip : key;
    assert(regex.test(good));
    (field.key === 'esp_ip' ? badIps : badKeys).forEach(function (value) { assert(!regex.test(value)); });
    assert.strictEqual(source.split(field.find).length - 1, 1);
});
['1.0.0.1', '126.255.255.254', '128.0.0.1', '223.255.255.254'].forEach(function (address) {
    assert(valid(settings(address, key))); assert(new RegExp(manifest.user_settings.fields[0].pattern).test(address));
});
function patch(address, secret) {
    return source.replace('"esp_ip": ""', '"esp_ip": ' + JSON.stringify(address))
        .replace('"key_hex": ""', '"key_hex": ' + JSON.stringify(secret));
}
function harness(code, packageId) {
    var tasks = [], request, running = false, busy = false, fail = false;
    var counts = { create: 0, start: 0, stop: 0, close: 0 }, replies = [];
    packageId = packageId || 'ambiSend40';
    var app = { appInfo: { packageId: packageId }, getRequestedAppControl: function () { return request; } };
    var context = { module: { exports: {} },
        setTimeout: function (fn, delay) { var timer = { fn: fn, delay: delay }; tasks.push(timer); return timer; },
        clearTimeout: function (timer) { timer.cancelled = true; },
        tizen: { application: { getCurrentApplication: function () { return app; } },
            ApplicationControlData: function (name, value) { this.key = name; this.value = value; } },
        require: function (name) {
            if (name === './receiver-config') return { valid: valid };
            assert.strictEqual(name, './sender');
            return { create: function (config) {
                counts.create++; assert(valid(config));
                assert.strictEqual(config.duration_ms, 0); assert.strictEqual(config.decoder, 'js-dc');
                return { start: function () { counts.start++; if (fail) throw new Error('injected'); running = true; },
                    stop: function () { counts.stop++; running = false; }, close: function () { counts.close++; },
                    busy: function () { return busy; }, metrics: function () { return { running: running }; } };
            } };
        }
    };
    vm.runInNewContext(code, context);
    return { counts: counts, replies: replies, lifecycle: context.module.exports,
        request: function (action, caller) {
            request = { callerAppId: caller === undefined ? packageId + '.Start' : caller,
                appControl: { operation: 'https://local.invalid/ambi4tizen/' + action },
                replyResult: function (data) { replies.push(data[0].value[0]); } };
            context.module.exports.onRequest();
        }, busy: function (value) { busy = value; }, fail: function () { fail = true; },
        loseCapture: function () { running = false; }, tick: function () {
            while (tasks.length) { var timer = tasks.shift(); if (!timer.cancelled) { timer.fn(); return; } }
            throw new Error('no timer');
        }
    };
}
// Installation/platform startup, untrusted caller and unknown operation remain idle.
var blank = harness(source); blank.lifecycle.onStart(); blank.lifecycle.onStart();
blank.request('start', 'other.Start'); blank.request('unknown');
assert.strictEqual(blank.counts.create, 0); assert.strictEqual(blank.replies.length, 0);
blank.request('start'); assert.strictEqual(blank.replies.pop(), 'configuration_required');
assert.strictEqual(blank.counts.create, 0);
badIps.forEach(function (address) { var h = harness(patch(address, key)); h.request('start'); assert.strictEqual(h.counts.create, 0); });
badKeys.forEach(function (secret) { var h = harness(patch(ip, secret)); h.request('start'); assert.strictEqual(h.counts.create, 0); });
[undefined, 'clonePkg01'].forEach(function (packageId) {
    var h = harness(patch(ip, key), packageId); h.lifecycle.onStart(); assert.strictEqual(h.counts.create, 0);
    h.request('start'); assert.strictEqual(h.replies.pop(), 'started');
    h.request('start'); assert.strictEqual(h.replies.pop(), 'already_running'); assert.strictEqual(h.counts.start, 1);
    h.busy(true); h.request('stop'); assert.strictEqual(h.counts.close, 0);
    h.request('start'); assert.strictEqual(h.replies.pop(), 'stopping');
    h.busy(false); h.tick(); assert.strictEqual(h.counts.close, 1); assert.strictEqual(h.replies.pop(), 'stopped');
    h.request('start'); assert.strictEqual(h.counts.start, 2);
    h.loseCapture(); h.tick(); assert.strictEqual(h.counts.close, 2);
    h.request('start'); h.lifecycle.onExit(); assert.strictEqual(h.counts.close, 3);
});
var failure = harness(patch(ip, key)); failure.fail(); failure.request('start');
assert.strictEqual(failure.replies.pop(), 'unable_to_start'); assert.strictEqual(failure.counts.close, 1);

// Launcher opening/reopening cannot capture; explicit OK/click is required.
function launcher(packageId) {
    var listeners = {}, calls = [], tasks = [], hidden = 0, exited = 0, ui;
    var start = { focus: function () { ui.document.activeElement = start; } };
    var stop = { focus: function () { ui.document.activeElement = stop; } }, state = {};
    var app = { appInfo: { packageId: packageId }, hide: function () { hidden++; }, exit: function () { exited++; } };
    ui = { window: {}, document: { getElementById: function (name) { return { start: start, stop: stop, state: state }[name]; },
        addEventListener: function (name, fn) { listeners[name] = fn; } },
        setTimeout: function (fn) { tasks.push(fn); return tasks.length; }, clearTimeout: function () {},
        tizen: { ApplicationControl: function (operation) { this.operation = operation; }, application: {
            getCurrentApplication: function () { return app; },
            launchAppControl: function (control, id, ok, fail, reply) { calls.push({ control: control, id: id, reply: reply }); }
        } }
    };
    vm.runInNewContext(fs.readFileSync('tv/catalog/index.html', 'utf8').split('<script>')[1].split('</script>')[0], ui);
    ui.window.onload(); assert.strictEqual(calls.length, 0); assert.strictEqual(ui.document.activeElement, start);
    return { calls: calls, start: start, stop: stop, state: state,
        key: function (code) { listeners.keydown({ keyCode: code, preventDefault: function () {} }); },
        hidden: function () { return hidden; }, exited: function () { return exited; } };
}
['ambiSend40', 'clonePkg01'].forEach(function (id) {
    var ui = launcher(id); ui.key(13); ui.start.onclick(); assert.strictEqual(ui.calls.length, 1);
    assert.strictEqual(ui.calls[0].id, id + '.Service'); assert(/\/start$/.test(ui.calls[0].control.operation));
    ui.calls[0].reply.onsuccess([{ value: ['configuration_required'] }]); assert.strictEqual(ui.hidden(), 0);
    ui.start.onclick(); ui.calls[1].reply.onsuccess([{ value: ['started'] }]); assert.strictEqual(ui.hidden(), 1);
    ui.key(39); ui.key(13); assert(/\/stop$/.test(ui.calls[2].control.operation));
    ui.calls[2].reply.onsuccess([{ value: ['stopped'] }]); assert.strictEqual(ui.hidden(), 1);
    ui.key(10009); assert.strictEqual(ui.exited(), 1);
});
console.log('PASS catalog: manual activation, invalid/partial settings, caller isolation, stop/drain, renamed IDs and UI');
