#pragma once
#include "ambi_config.h"
typedef struct {
    float smoothed[AMBI_MAX_LEDS][3];
    uint8_t gamma[256];
    uint64_t last_ms;
    bool initialized;
    unsigned estimated_ma;
} ambi_color_engine_t;
void ambi_color_init(ambi_color_engine_t *, const ambi_config_t *);
unsigned ambi_physical_index(const ambi_config_t *, unsigned canonical);
void ambi_color_render(ambi_color_engine_t *, const ambi_config_t *, const ambi_frame_t *,
    ambi_mode_t effective, ambi_rgb_t ambient, uint64_t now_ms, ambi_rgb_t *output);
