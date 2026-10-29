#pragma once
#include "ambi_config.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
typedef struct { ambi_frame_t frame; uint64_t received_ms; } ambi_received_t;
typedef struct { uint32_t accepted,invalid,unauthorized,stale,socket_errors; } ambi_rx_stats_t;
esp_err_t ambi_receiver_start(const ambi_config_t *, QueueHandle_t latest_frame);
void ambi_receiver_stats(ambi_rx_stats_t *);
esp_err_t ambi_wifi_start(const ambi_config_t *);
bool ambi_wifi_connected(void);
