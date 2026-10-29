#pragma once
#include "ambi_protocol.h"

#define AMBI_MAX_LEDS 600
#define AMBI_CONFIG_BYTES 320
typedef enum { AMBI_OFF, AMBI_AMBILIGHT, AMBI_AMBIENT, AMBI_AUTO } ambi_mode_t;
typedef struct {
    uint32_t profile_id;
    char ssid[33], password[65], source_ip[16], api_token[65];
    uint8_t key[32];
    uint16_t leds_left, leds_top, leds_right, start_offset;
    uint16_t gamma_milli, smoothing_ms, timeout_ms, max_age_ms, max_lag_ms;
    uint16_t current_limit_ma, white_pixel_ma, udp_port;
    int16_t gpio;
    uint8_t brightness, brightness_cap;
    bool reverse, output_enabled, ambient_on;
    ambi_mode_t mode;
    ambi_rgb_t ambient;
} ambi_config_t;
void ambi_config_defaults(ambi_config_t *config);
bool ambi_config_validate(const ambi_config_t *config);
bool ambi_config_encode(const ambi_config_t *config, uint8_t out[AMBI_CONFIG_BYTES]);
bool ambi_config_decode(const uint8_t *data, size_t size, ambi_config_t *out);
unsigned ambi_led_count(const ambi_config_t *config);
bool ambi_key_configured(const uint8_t key[32]);
#ifdef ESP_PLATFORM
#include "esp_err.h"
esp_err_t configuration_load(const ambi_config_t *defaults, ambi_config_t *out);
esp_err_t configuration_save(const ambi_config_t *config);
#endif
