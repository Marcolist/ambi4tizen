'use strict';
// Repository import. The widget builder materializes the shared implementation here.
var core = require('../poc/web-probe/capture-core');
function adapters(d) {
    d = d || {};
    if (!d.native) d.native = function () { return require('./native-decoder').create(); };
    if (!d.persistent) d.persistent = function () { return require('./persistent-broker').create(); };
    return d;
}
exports.clock = core.clock;
exports.create = function (d) { return core.create(adapters(d)); };
exports.createReader = function (d) { return core.createReader(adapters(d)); };
