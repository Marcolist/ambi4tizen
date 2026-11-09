'use strict';
// Validate before constructing a sender (and therefore before opening UDP).
exports.valid = function (config) {
    if (!config || typeof config.esp_ip !== 'string' || typeof config.key_hex !== 'string') return false;
    if (!/^[0-9a-fA-F]{64}$/.test(config.key_hex) || /^0{64}$/.test(config.key_hex)) return false;
    var parts = config.esp_ip.split('.');
    if (parts.length !== 4 || !parts.every(function (part) {
        return /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255;
    })) return false;
    return Number(parts[0]) > 0 && Number(parts[0]) < 224 && Number(parts[0]) !== 127 &&
        Number(parts[3]) > 0 && Number(parts[3]) < 255;
};
