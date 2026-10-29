'use strict';
var zones = require('./zones'), protocol = require('./protocol'), core = require('./capture-core');
exports.create = function (config, dependencies) {
    var d = dependencies || {}, clock = d.clock || core.clock, capture = d.capture || core.create();
    var socket = d.socket || require('dgram').createSocket('udp4');
    var later = d.setTimeout || setTimeout, cancel = d.clearTimeout || clearTimeout;
    var session = (d.randomBytes || require('crypto').randomBytes)(8), sequence = 0;
    var key = new Buffer(config.key_hex || '', 'hex'), running = false, inFlight = false, timer, deadline, lastCaptureStart;
    var metrics = { captures: 0, sent: 0, errors: 0, consecutive_errors: 0, running: false,
        continuous: config.duration_ms === 0, stop_reason: null, last_sent: null, profiles: {}, memory: {} };
    function validate() {
        zones.layout(config.zones);
        if (!/^([0-9a-f]{64})$/i.test(config.key_hex || '') || !key.some(function (v) { return v !== 0; })) throw new Error('key');
        var address = (config.esp_ip || '').split('.');
        if (address.length !== 4 || !address.every(function (p) { return /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255; }) ||
            Number(address[0]) === 0 || Number(address[0]) >= 224 || Number(address[3]) === 255 || Number(address[3]) === 0) throw new Error('unicast IPv4 required');
        if (config.port !== Math.floor(config.port) || config.port < 1024 || config.port > 65535 ||
            config.interval_ms !== Math.floor(config.interval_ms) || config.interval_ms < 250 || config.interval_ms > 10000 ||
            config.duration_ms !== Math.floor(config.duration_ms) || (config.duration_ms !== 0 && config.duration_ms < 1000) || config.duration_ms > 3600000 ||
            ['480x270', '320x180', '160x90'].indexOf(config.resolution) === -1 ||
            !(config.edge_depth >= 0.02 && config.edge_depth <= 0.25)) throw new Error('sender configuration');
    }
    socket.on('error', function () { metrics.errors++; stop('socket_error'); });
    function stop(reason) {
        if (running) metrics.stop_reason = reason || 'requested';
        running = false; metrics.running = false; if (timer) cancel(timer);
    }
    function profile(result) {
        Object.keys(result.profile_ms || {}).forEach(function (name) {
            var value = result.profile_ms[name], stat = metrics.profiles[name] || { count: 0, sum_ms: 0, max_ms: 0 };
            stat.count++; stat.sum_ms += value; stat.max_ms = Math.max(stat.max_ms, value); metrics.profiles[name] = stat;
        });
        var m = process.memoryUsage();
        Object.keys(m).forEach(function (name) {
            var stat = metrics.memory[name] || { first: m[name], peak: m[name], last: m[name] };
            stat.peak = Math.max(stat.peak, m[name]); stat.last = m[name]; metrics.memory[name] = stat;
        });
    }
    function tick() {
        if (!running || inFlight) return;
        var began = clock(); if (began >= deadline) return stop('duration');
        inFlight = true;
        capture({ resolution: config.resolution, hash: false }, function (image) { return zones.summarize(image, config.zones, config.edge_depth); }, function (result) {
            inFlight = false; metrics.captures++; profile(result);
            if (!running) return;
            if (clock() >= deadline) return stop('duration');
            if (result.status !== 'ok' || !result.temporary_file_removed) {
                metrics.errors++; metrics.consecutive_errors++;
                if (!result.temporary_file_removed) return stop('cleanup_error');
                if (metrics.consecutive_errors >= 3) return stop('capture_errors');
                schedule(); return;
            }
            try {
                var age = Math.ceil(clock() - result.started_ms);
                if (age > 1500 || age < 0) throw new Error('capture too old');
                var packet = protocol.encode({ session: session, sequence: sequence, capture_ms: Math.floor(result.started_ms) >>> 0,
                    age_ms: age, sections: result.colors.sections, colors: result.colors.zones_rgb, brightness: config.brightness }, key);
                sequence = (sequence + 1) >>> 0;
                socket.send(packet, 0, packet.length, config.port, config.esp_ip, function (err) {
                    if (err) { metrics.errors++; metrics.consecutive_errors++; } else {
                        metrics.sent++; metrics.consecutive_errors = 0;
                        var colors = [], count = packet.readUInt16BE(6);
                        for (var i = 0; i < count; i++) colors.push([packet[32 + 3*i], packet[33 + 3*i], packet[34 + 3*i]]);
                        metrics.last_sent = { sequence: packet.readUInt32BE(16), age_ms: packet.readUInt16BE(24),
                            width: result.colors.width, height: result.colors.height,
                            sections: [packet[27], packet[28], packet[29]], zones_rgb: colors };
                        lastCaptureStart = result.started_ms;
                    }
                    if (metrics.consecutive_errors >= 3) stop('send_errors');
                    schedule();
                });
            } catch (e) { metrics.errors++; metrics.consecutive_errors++; if (metrics.consecutive_errors >= 3) stop('frame_errors'); schedule(); }
        });
        function schedule() { if (running) timer = later(tick, Math.max(0, config.interval_ms - (clock() - began))); }
    }
    return {
        start: function () { validate(); if (running || inFlight) throw new Error('already active'); running = true; metrics.running = true;
            metrics.stop_reason = null; metrics.consecutive_errors = 0;
            deadline = config.duration_ms === 0 ? Infinity : clock() + config.duration_ms; tick(); },
        stop: stop,
        close: function () { stop(); socket.close(); },
        busy: function () { return inFlight; },
        metrics: function () {
            var snapshot = JSON.parse(JSON.stringify(metrics));
            if (snapshot.last_sent) snapshot.last_sent.capture_age_ms = Math.max(0, Math.ceil(clock() - lastCaptureStart));
            return snapshot;
        }
    };
};
