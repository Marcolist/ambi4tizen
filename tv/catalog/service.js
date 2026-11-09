'use strict';
// Public template: these two exact empty fields are patched before signing.
var CONFIG = {
    "esp_ip": "",
    "key_hex": "",
    "port": 19446,
    "zones": 12,
    "resolution": "480x270",
    "edge_depth": 0.1,
    "interval_ms": 100,
    "duration_ms": 0,
    "jpeg_quality": 55,
    "decoder": "js-dc",
    "broker": "process",
    "decode_scale": 1,
    "pipeline": false
};
var START = 'https://local.invalid/ambi4tizen/start';
var STOP = 'https://local.invalid/ambi4tizen/stop';
var sender, stopping = false, watch;
function reply(request, status) {
    try { request.replyResult([new tizen.ApplicationControlData('status', [status])]); } catch (ignored) {}
}
function stop(done) {
    if (stopping) return done('stopping');
    stopping = true;
    if (watch) { clearTimeout(watch); watch = null; }
    if (sender) sender.stop();
    function drain() {
        if (sender && sender.busy()) return setTimeout(drain, 100);
        if (sender) sender.close();
        sender = null; stopping = false; done('stopped');
    }
    drain();
}
function observe() {
    watch = null;
    if (!sender || stopping) return;
    if (!sender.metrics().running) return stop(function () {});
    watch = setTimeout(observe, 1000);
}
// A platform/install/service launch never starts capture by itself.
module.exports.onStart = function () {};
module.exports.onRequest = function () {
    var request, app;
    try {
        app = tizen.application.getCurrentApplication();
        request = app.getRequestedAppControl();
    } catch (e) { return; }
    if (!request || !request.appControl || request.callerAppId !== app.appInfo.packageId + '.Start') return;
    if (request.appControl.operation === STOP) return stop(function (status) { reply(request, status); });
    if (request.appControl.operation !== START) return;
    if (stopping) return reply(request, 'stopping');
    if (!require('./receiver-config').valid(CONFIG)) return reply(request, 'configuration_required');
    if (sender) {
        if (sender.metrics().running) return reply(request, 'already_running');
        return stop(function () { reply(request, 'retry'); });
    }
    try {
        sender = require('./sender').create(CONFIG);
        sender.start();
        watch = setTimeout(observe, 1000);
        reply(request, 'started');
    } catch (e) { stop(function () { reply(request, 'unable_to_start'); }); }
};
module.exports.onStop = function () { stop(function () {}); };
module.exports.onExit = module.exports.onStop;
