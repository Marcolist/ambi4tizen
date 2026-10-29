#pragma once
#include "ambi_config.h"
typedef struct { ambi_mode_t requested; bool ambient_on; ambi_rgb_t ambient; } ambi_mode_state_t;
void ambi_mode_init(ambi_mode_state_t *, const ambi_config_t *);
void ambi_mode_set(ambi_mode_state_t *, ambi_mode_t);
ambi_mode_t ambi_mode_effective(const ambi_mode_state_t *, bool stream_present,
    uint64_t last_frame_ms, uint64_t now_ms, uint32_t timeout_ms);
