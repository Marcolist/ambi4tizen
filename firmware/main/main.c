#include "ambi_config.h"
#include "ambi_mode.h"
#include "ambi_color.h"
#include "ambi_led.h"
#include "diagnostics.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "freertos/task.h"
#ifdef AMBI_PRIVATE_CONFIG
#include "private_config.h"
#endif
static ambi_config_t config;
static ambi_color_engine_t colors;
static ambi_rgb_t pixels[AMBI_MAX_LEDS];
static const char *TAG="ambilight";
void app_main(void) {
    ambi_config_t defaults; ambi_config_defaults(&defaults);
#ifdef AMBI_PRIVATE_CONFIG
    ambi_private_config(&defaults);
#endif
    if(!ambi_config_validate(&defaults)) { ESP_LOGE(TAG,"Invalid compiled configuration; stopped");return; }
    int last_error=configuration_load(&defaults,&config);
    if(last_error!=ESP_OK) { /* Corruption/storage failure: network diagnostics allowed, LEDs fail closed. */
        config=defaults; config.output_enabled=false; config.mode=AMBI_OFF;
        ESP_LOGE(TAG,"Configuration storage error %d; LED output disabled",last_error);
    }
    ambi_mode_state_t mode; ambi_mode_init(&mode,&config); ambi_color_init(&colors,&config);
    QueueHandle_t frames=xQueueCreate(1,sizeof(ambi_received_t)),commands=xQueueCreate(4,sizeof(ambi_command_t));
    if(!frames || !commands) { ESP_LOGE(TAG,"Queue allocation failed");return; }
    esp_err_t error=ambi_led_init(&config);
    if(error!=ESP_OK) {last_error=error;ESP_LOGE(TAG,"LED initialization failed: %d",error);}
    error=ambi_wifi_start(&config);
    if(error!=ESP_OK) {last_error=error;ESP_LOGE(TAG,"Wi-Fi not configured/failed: %d",error);}
    else {
        error=ambi_receiver_start(&config,frames); if(error!=ESP_OK)last_error=error;
        error=ambi_diagnostics_start(&config,commands); if(error!=ESP_OK)last_error=error;
    }
    ambi_received_t latest={0}; bool have_frame=false; uint64_t last_report=0;
    TickType_t wake=xTaskGetTickCount();
    for(;;) {
        uint64_t now=esp_timer_get_time()/1000;
        ambi_received_t frame; if(xQueueReceive(frames,&frame,0)==pdTRUE) {latest=frame;have_frame=true;}
        ambi_command_t command;
        if(xQueueReceive(commands,&command,0)==pdTRUE) {
            ambi_config_t next=config;
            if(command.set_mode) { next.mode=command.mode; if(command.mode==AMBI_OFF)next.ambient_on=false; if(command.mode==AMBI_AMBIENT)next.ambient_on=true; }
            if(command.set_brightness)next.brightness=command.brightness;
            if(command.set_ambient) {next.ambient=command.ambient;next.ambient_on=true;}
            /* Commit first. A failed NVS write must not pretend the setting persisted. */
            error=configuration_save(&next);
            if(error==ESP_OK) {config=next;ambi_mode_init(&mode,&config);} else last_error=error;
        }
        ambi_mode_t effective=ambi_mode_effective(&mode,have_frame,latest.received_ms,now,config.timeout_ms);
        ambi_color_render(&colors,&config,have_frame?&latest.frame:NULL,effective,mode.ambient,now,pixels);
        error=ambi_led_write(pixels,ambi_led_count(&config));
        if(error!=ESP_OK) {last_error=error;ambi_led_stop();ESP_LOGE(TAG,"LED driver stopped after error %d",error);}
        if(now-last_report>=1000) {
            ambi_status_t status={.requested=mode.requested,.effective=effective,.wifi=ambi_wifi_connected(),.led_ready=ambi_led_ready(),
                .leds=ambi_led_count(&config),.estimated_ma=colors.estimated_ma,.free_heap=esp_get_free_heap_size(),.min_heap=esp_get_minimum_free_heap_size(),
                .uptime_ms=now,.stream=have_frame && now-latest.received_ms<=config.timeout_ms,.last_error=last_error};
            status.smoothing_ms=colors.active_smoothing_ms;status.fast_transition=colors.fast_transition;
            status.scene_changes=colors.scene_changes;
            ambi_receiver_stats(&status.rx); ambi_diagnostics_publish(&status); last_report=now;
            if(now%10000<1000)ESP_LOGI(TAG,"mode=%u heap=%u accepted=%lu stale=%lu led=%u",effective,status.free_heap,(unsigned long)status.rx.accepted,(unsigned long)status.rx.stale,status.led_ready);
        }
        vTaskDelayUntil(&wake,pdMS_TO_TICKS(20));
    }
}
