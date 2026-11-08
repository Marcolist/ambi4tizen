'use strict';
// Small ES5 client for the three fixed capture/preflight calls. No dependency
// loader, arbitrary transport, file descriptor passing or exported services.
var net = require('net'), fs = require('fs'), EventEmitter = require('events').EventEmitter;
exports.systemAddress = function () {
    var paths = ['/run/dbus/system_bus_socket', '/var/run/dbus/system_bus_socket', '/opt/var/run/dbus/system_bus_socket'];
    for (var i = 0; i < paths.length; i++) {
        try { if (fs.statSync(paths[i]).isSocket()) return 'unix:path=' + paths[i]; } catch (e) {}
    }
    return 'unix:path=/var/run/dbus/system_bus_socket';
};
function pad(n, alignment) { return (alignment - n % alignment) % alignment; }
function zeros(n) { var b = new Buffer(n); b.fill(0); return b; }
function encode(signature, values, base) {
    var parts = [], length = base || 0;
    signature.split('').forEach(function (type, index) {
        var value = values[index], b, p = pad(length, type === 'g' ? 1 : 4);
        if (p) { parts.push(zeros(p)); length += p; }
        if (type === 'i' || type === 'u') {
            b = new Buffer(4); if (type === 'i') b.writeInt32LE(value, 0); else b.writeUInt32LE(value, 0);
        } else if (type === 's' || type === 'o') {
            var text = new Buffer(value, 'utf8'); if (text.length > 4096) throw new Error('dbus_string_bound');
            b = zeros(5 + text.length); b.writeUInt32LE(text.length, 0); text.copy(b, 4);
        } else if (type === 'g') {
            if (value.length > 255) throw new Error('dbus_signature_bound');
            b = zeros(2 + value.length); b[0] = value.length; b.write(value, 1, 'ascii');
        } else throw new Error('dbus_type');
        parts.push(b); length += b.length;
    });
    return Buffer.concat(parts);
}
function decode(buffer, signature, offset, limit) {
    var values = [], pos = offset;
    signature.split('').forEach(function (type) {
        pos += pad(pos, type === 'g' ? 1 : 4);
        var size, value;
        if (type === 'i' || type === 'u') {
            if (pos + 4 > limit) throw new Error('dbus_truncated_integer');
            value = type === 'i' ? buffer.readInt32LE(pos) : buffer.readUInt32LE(pos); pos += 4;
        } else if (type === 's' || type === 'o' || type === 'g') {
            var prefix = type === 'g' ? 1 : 4;
            if (pos + prefix > limit) throw new Error('dbus_truncated_length');
            size = prefix === 1 ? buffer[pos] : buffer.readUInt32LE(pos); pos += prefix;
            if (size > 65536 || pos + size + 1 > limit || buffer[pos + size] !== 0) throw new Error('dbus_string');
            value = buffer.toString(type === 'g' ? 'ascii' : 'utf8', pos, pos + size); pos += size + 1;
        } else throw new Error('dbus_reply_type');
        values.push(value);
    });
    return { values: values, end: pos };
}
function message(serial, options) {
    var fields = [[1,'o',options.path],[2,'s',options.interface],[3,'s',options.member],[6,'s',options.destination]];
    if (options.signature) fields.push([8,'g',options.signature]);
    var parts = [], length = 16;
    fields.forEach(function (field) {
        var p = pad(length, 8); if (p) { parts.push(zeros(p)); length += p; }
        parts.push(new Buffer([field[0], 1, field[1].charCodeAt(0), 0])); length += 4;
        var value = encode(field[1], [field[2]], length); parts.push(value); length += value.length;
    });
    var body = encode(options.signature || '', options.body || [], 0), header = zeros(16);
    header[0] = 108; header[1] = 1; header[3] = 1;
    header.writeUInt32LE(body.length, 4); header.writeUInt32LE(serial, 8); header.writeUInt32LE(length - 16, 12);
    return Buffer.concat([header, Buffer.concat(parts), zeros(pad(length, 8)), body]);
}
exports.createClient = function (options) {
    var match = /^unix:path=([^,;]+)(?:,guid=[a-f0-9]+)?$/.exec(options.busAddress);
    if (!match) throw new Error('dbus_fixed_unix_transport');
    var connection = new EventEmitter(), stream = net.createConnection(decodeURIComponent(match[1]));
    connection.stream = stream;
    var ready = false, buffered = new Buffer(0), serial = 1, pending = {}, queue = [], failed = false;
    function error(reason) {
        if (failed) return; failed = true; stream.destroy();
        connection.emit('error', reason instanceof Error ? reason : new Error(reason));
    }
    stream.on('error', error);
    stream.on('end', function () { connection.emit('end'); });
    stream.on('connect', function () {
        try {
            var uid = process.getuid();
            stream.write('\0AUTH EXTERNAL ' + new Buffer(String(uid), 'ascii').toString('hex') + '\r\n');
        } catch (e) { error(e); }
    });
    function receive(frame) {
        var fieldsEnd = 16 + frame.readUInt32LE(12), pos = 16, replySerial, signature = '';
        while (pos < fieldsEnd) {
            pos += pad(pos, 8); if (pos === fieldsEnd) break;
            if (pos + 4 > fieldsEnd) throw new Error('dbus_header');
            var id = frame[pos++], variant = decode(frame, 'g', pos, fieldsEnd); pos = variant.end;
            if (variant.values[0].length !== 1) throw new Error('dbus_header_variant');
            var value = decode(frame, variant.values[0], pos, fieldsEnd); pos = value.end;
            if (id === 5) replySerial = value.values[0];
            if (id === 8) signature = value.values[0];
        }
        if (frame[1] !== 2 && frame[1] !== 3) return;
        var item = pending[replySerial]; if (!item) return;
        delete pending[replySerial];
        if ((frame[1] === 2 && signature !== item.signature) ||
            (frame[1] === 3 && signature !== '' && signature !== 's')) throw new Error('dbus_reply_signature');
        var body = decode(frame, signature, fieldsEnd + pad(fieldsEnd, 8), frame.length);
        if (body.end !== frame.length) throw new Error('dbus_trailing_body');
        item.done.apply(null, frame[1] === 3 ? [new Error('dbus_method_denied')] : [null].concat(body.values));
    }
    stream.on('data', function (data) {
        try {
            if (buffered.length + data.length > 131104) throw new Error('dbus_buffer_bound');
            buffered = Buffer.concat([buffered, data]);
            if (!ready) {
                var lineEnd = buffered.toString('ascii').indexOf('\r\n');
                if (lineEnd < 0) { if (buffered.length > 512) throw new Error('dbus_auth_bound'); return; }
                if (!/^OK [a-f0-9]+$/.test(buffered.toString('ascii', 0, lineEnd))) throw new Error('dbus_auth_denied');
                buffered = buffered.slice(lineEnd + 2); stream.write('BEGIN\r\n'); ready = true;
                queue.forEach(function (request) { stream.write(request); }); queue = [];
            }
            while (buffered.length >= 16) {
                if (buffered[0] !== 108 || buffered[3] !== 1) throw new Error('dbus_protocol');
                var bodyLength = buffered.readUInt32LE(4), fieldsLength = buffered.readUInt32LE(12);
                if (bodyLength > 65536 || fieldsLength > 65536) throw new Error('dbus_frame_bound');
                var end = 16 + fieldsLength, total = end + pad(end, 8) + bodyLength;
                if (buffered.length < total) return;
                var frame = buffered.slice(0, total); buffered = buffered.slice(total); receive(frame);
            }
        } catch (e) { error(e); }
    });
    function invoke(request, callback) {
        if (failed) return callback(new Error('dbus_closed'));
        if (Object.keys(pending).length >= 2) throw new Error('dbus_pending_bound');
        if (!((request.destination === 'org.freedesktop.DBus' && request.member === 'Hello') ||
              (request.destination === 'samsung.tizen.dcapture' && request.path === '/samsung/tizen/dcapture' &&
               ((request.interface === 'samsung.tizen.dcapture' && request.member === 'RequestCaptureToFileSync') ||
                (request.interface === 'org.freedesktop.DBus.Introspectable' && request.member === 'Introspect'))))) throw new Error('dbus_fixed_method');
        var id = serial++, bytes = message(id, request);
        pending[id] = { done: callback, signature: request.member === 'RequestCaptureToFileSync' ? 'iiis' : 's' };
        if (ready) stream.write(bytes); else queue.push(bytes);
    }
    return { connection: connection, invoke: invoke, invokeDbus: function (request, callback) {
        invoke({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus', member: request.member }, callback);
    } };
};
