#pragma once
#include "ambi_config.h"
#include "esp_err.h"
esp_err_t ambi_led_init(const ambi_config_t *);
esp_err_t ambi_led_write(const ambi_rgb_t *, unsigned count);
void ambi_led_stop(void);
bool ambi_led_ready(void);
