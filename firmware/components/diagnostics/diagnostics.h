#pragma once
#include "receiver.h"
typedef struct { bool set_mode,set_brightness,set_ambient; ambi_mode_t mode; uint8_t brightness; ambi_rgb_t ambient; } ambi_command_t;
typedef struct {
    ambi_mode_t requested,effective;
    bool wifi,led_ready,stream;
    unsigned leds,estimated_ma,free_heap,min_heap;
    unsigned smoothing_ms;
    uint32_t scene_changes;
    bool fast_transition;
    uint64_t uptime_ms;
    int last_error;
    ambi_rx_stats_t rx;
} ambi_status_t;
esp_err_t ambi_diagnostics_start(const ambi_config_t *,QueueHandle_t commands);
void ambi_diagnostics_publish(const ambi_status_t *);
