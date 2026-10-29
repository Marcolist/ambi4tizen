'use strict';
// Fixed read-only diagnostics. No shell, process control or settings writes.
var fs = require('fs'), os = require('os'), cp = require('child_process');
exports.metrics = function (done) {
    var result = { timestamp_ms: Date.now(), memory_total_bytes: os.totalmem(),
        memory_free_bytes: os.freemem(), load_average: os.loadavg() };
    try { result.meminfo = fs.readFileSync('/proc/meminfo', 'utf8').slice(0, 8192); }
    catch (e) { result.meminfo_error = e.code; }
    var df = fs.existsSync('/bin/df') ? '/bin/df' : (fs.existsSync('/usr/bin/df') ? '/usr/bin/df' : null);
    if (!df) { result.disk_error = 'No df in checked paths'; return done(result); }
    cp.execFile(df, ['-k', '/opt/usr'], { timeout: 1500, maxBuffer: 8192 }, function (err, stdout, stderr) {
        result.disk = stdout;
        if (err) result.disk_error = String(err) + '; ' + stderr;
        done(result);
    });
};
