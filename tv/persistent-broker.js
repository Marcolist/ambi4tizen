'use strict';
// Fixed EXTERNAL-authenticated client; only mode-0 JPEG capture is exposed.
exports.create = function (dependencies) {
    var d = dependencies || {}, bus, pending, disabled = false, ready = false, closing = false;
    var metrics = { connected: false, calls: 0, failures: 0 };
    function finish(err, values) {
        if (err && !closing) {
            metrics.failures++; metrics.connected = false; disabled = true;
            if (pending && !pending.sent) err.retrySafe = true;
            if (bus) { var old = bus; bus = null; old.connection.stream.destroy(); }
        }
        if (!pending) return;
        var p = pending; pending = null; clearTimeout(p.timer); p.done(err, values);
    }
    function issue() {
        if (!ready || !pending || pending.sent) return;
        var options = pending.options; pending.sent = true;
        bus.invoke({ destination: 'samsung.tizen.dcapture', path: '/samsung/tizen/dcapture', interface: 'samsung.tizen.dcapture',
            member: 'RequestCaptureToFileSync', signature: 'iiiiiiss',
            body: [0, 0, 1, options.width, options.height, options.quality, '/dev/shm', options.basename] },
            function (err, code, w, h, path) { finish(err ? new Error('persistent_method') : null, [code, w, h, path]); });
    }
    return {
        call: function (options, done) {
            if (disabled || pending) { var no = new Error(disabled ? 'persistent_disabled' : 'persistent_busy'); no.retrySafe = true; return done(no); }
            pending = { done: done, options: options, sent: false,
                timer: setTimeout(function () { finish(new Error('persistent_timeout')); }, 3500) };
            try {
                if (!bus) {
                    bus = (d.client || require('dbus-native').createClient)({
                        busAddress: d.address || 'unix:path=/var/run/dbus/system_bus_socket',
                        authMethods: ['EXTERNAL'], direct: true
                    });
                    bus.connection.on('error', function () { finish(new Error('persistent_connection')); });
                    bus.connection.on('end', function () { if (!closing) finish(new Error('persistent_closed')); });
                    // Handle Hello ourselves: upstream's automatic Hello throws on an error.
                    bus.invokeDbus({ member: 'Hello' }, function (err, name) {
                        if (err) return finish(new Error('persistent_hello'));
                        if (!bus || disabled) return;
                        bus.name = name; ready = true; metrics.connected = true; issue();
                    });
                }
                metrics.calls++; issue();
            } catch (e) { finish(e); }
        },
        close: function () {
            closing = true; disabled = true;
            if (bus) { bus.connection.stream.destroy(); bus = null; }
            if (pending) finish(new Error('persistent_stopped'));
        },
        stats: function () { return JSON.parse(JSON.stringify(metrics)); }
    };
};
