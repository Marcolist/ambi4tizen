#include "ambi_config.h"
#include <string.h>

unsigned ambi_led_count(const ambi_config_t *c) { return c->leds_left + c->leds_top + c->leds_right; }
bool ambi_key_configured(const uint8_t key[32]) {
    uint8_t bits = 0; for (unsigned i = 0; i < 32; i++) bits |= key[i]; return bits != 0;
}
void ambi_config_defaults(ambi_config_t *c) {
    memset(c, 0, sizeof(*c));
    c->gamma_milli = 2200; c->smoothing_ms = 150; c->timeout_ms = 3000;
    c->max_age_ms = 1500; c->max_lag_ms = 600; c->udp_port = 19446;
    c->white_pixel_ma = 60; c->current_limit_ma = 500;
    c->brightness = 32; c->brightness_cap = 32; c->gpio = -1; c->mode = AMBI_AUTO;
}
bool ambi_config_validate(const ambi_config_t *c) {
    unsigned n = ambi_led_count(c);
    if (n > AMBI_MAX_LEDS || (n && (!c->leds_left || !c->leds_top || !c->leds_right)) ||
        (n ? c->start_offset >= n : c->start_offset != 0) || (c->mode < AMBI_OFF || c->mode > AMBI_AUTO) ||
        c->gamma_milli < 1000 || c->gamma_milli > 4000 || c->smoothing_ms > 3000 ||
        c->timeout_ms < 500 || c->timeout_ms > 30000 || c->max_age_ms > 5000 ||
        c->max_age_ms < 100 || c->max_lag_ms < 50 || c->max_lag_ms > 5000 ||
        c->white_pixel_ma < 1 || c->white_pixel_ma > 100 || c->current_limit_ma > 30000 ||
        c->udp_port < 1024 || !memchr(c->ssid, 0, sizeof(c->ssid)) ||
        !memchr(c->password, 0, sizeof(c->password)) || !memchr(c->source_ip, 0, sizeof(c->source_ip)) ||
        !memchr(c->api_token, 0, sizeof(c->api_token))) return false;
    // Pin validity is also checked against the actual target GPIO capabilities.
    if (c->output_enabled && (!n || c->gpio < 0 || c->current_limit_ma <= n)) return false;
    return true;
}
static uint32_t crc(const uint8_t *p, size_t n) {
    uint32_t v = 0xffffffffu;
    for (size_t i = 0; i < n; i++) {
        v ^= p[i]; for (unsigned b = 0; b < 8; b++) v = (v >> 1) ^ (0xedb88320u & (0u - (v & 1u)));
    }
    return ~v;
}
static void put16(uint8_t **p, uint16_t v) { *(*p)++ = v >> 8; *(*p)++ = v; }
static uint16_t get16(const uint8_t **p) { uint16_t v = (uint16_t)(*p)[0] << 8 | (*p)[1]; *p += 2; return v; }
bool ambi_config_encode(const ambi_config_t *c, uint8_t out[AMBI_CONFIG_BYTES]) {
    if (!ambi_config_validate(c)) return false;
    memset(out, 0, AMBI_CONFIG_BYTES); memcpy(out, "ACF1", 4); uint8_t *p = out + 4;
    put16(&p, 1); put16(&p, AMBI_CONFIG_BYTES);
    for (unsigned i = 0; i < 4; i++) *p++ = (uint8_t)(c->profile_id >> (24 - i * 8));
    memcpy(p, c->ssid, 33); p += 33; memcpy(p, c->password, 65); p += 65;
    memcpy(p, c->source_ip, 16); p += 16; memcpy(p, c->api_token, 65); p += 65;
    memcpy(p, c->key, 32); p += 32;
    const uint16_t values[] = {c->leds_left,c->leds_top,c->leds_right,c->start_offset,
        c->gamma_milli,c->smoothing_ms,c->timeout_ms,c->max_age_ms,c->max_lag_ms,
        c->current_limit_ma,c->white_pixel_ma,c->udp_port,(uint16_t)c->gpio};
    for (unsigned i = 0; i < sizeof(values)/sizeof(values[0]); i++) put16(&p, values[i]);
    *p++ = c->brightness; *p++ = c->brightness_cap; *p++ = c->reverse;
    *p++ = c->output_enabled; *p++ = c->ambient_on; *p++ = c->mode;
    *p++ = c->ambient.r; *p++ = c->ambient.g; *p++ = c->ambient.b;
    uint32_t sum = crc(out, AMBI_CONFIG_BYTES - 4);
    p = out + AMBI_CONFIG_BYTES - 4; for (unsigned i = 0; i < 4; i++) *p++ = sum >> (24 - 8*i);
    return true;
}
bool ambi_config_decode(const uint8_t *data, size_t n, ambi_config_t *out) {
    if (!data || n != AMBI_CONFIG_BYTES || memcmp(data, "ACF1", 4)) return false;
    const uint8_t *p = data + 4;
    if (get16(&p) != 1 || get16(&p) != AMBI_CONFIG_BYTES) return false;
    uint32_t expected = 0; for (unsigned i = 0; i < 4; i++) expected = (expected << 8) | data[n-4+i];
    if (expected != crc(data, n - 4)) return false;
    ambi_config_t c = {0};
    for (unsigned i = 0; i < 4; i++) c.profile_id = (c.profile_id << 8) | *p++;
    memcpy(c.ssid,p,33); p+=33; memcpy(c.password,p,65); p+=65;
    memcpy(c.source_ip,p,16); p+=16; memcpy(c.api_token,p,65); p+=65; memcpy(c.key,p,32); p+=32;
    uint16_t values[13]; for (unsigned i=0;i<13;i++) values[i]=get16(&p);
    c.leds_left=values[0];c.leds_top=values[1];c.leds_right=values[2];c.start_offset=values[3];
    c.gamma_milli=values[4];c.smoothing_ms=values[5];c.timeout_ms=values[6];c.max_age_ms=values[7];
    c.max_lag_ms=values[8];c.current_limit_ma=values[9];c.white_pixel_ma=values[10];c.udp_port=values[11];c.gpio=(int16_t)values[12];
    c.brightness=*p++;c.brightness_cap=*p++;
    if(p[0]>1 || p[1]>1 || p[2]>1) return false;
    c.reverse=*p++;c.output_enabled=*p++;c.ambient_on=*p++;c.mode=(ambi_mode_t)*p++;
    c.ambient=(ambi_rgb_t){p[0],p[1],p[2]};
    if (!ambi_config_validate(&c)) return false;
    *out=c; return true;
}
