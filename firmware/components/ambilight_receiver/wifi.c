#include "receiver.h"
#include "ambi_reconnect.h"
#include "esp_event.h"
#include "esp_check.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "freertos/task.h"
#include <string.h>
/* Event handler sends transitions to one owner; no shared reconnect-state races. */
static QueueHandle_t events;
static portMUX_TYPE wifi_lock=portMUX_INITIALIZER_UNLOCKED;
static bool online;
static void event_handler(void *arg,esp_event_base_t base,int32_t id,void *data) {
    (void)arg;(void)data;
    int event=(base==IP_EVENT && id==IP_EVENT_STA_GOT_IP) ? 1 : 0;
    if((base==WIFI_EVENT && (id==WIFI_EVENT_STA_START || id==WIFI_EVENT_STA_DISCONNECTED)) || event) xQueueOverwrite(events,&event);
}
bool ambi_wifi_connected(void) { portENTER_CRITICAL(&wifi_lock); bool value=online; portEXIT_CRITICAL(&wifi_lock); return value; }
static void reconnect_task(void *arg) {
    (void)arg; ambi_reconnect_t state={0};
    for(;;) {
        int event;
        if(xQueueReceive(events,&event,pdMS_TO_TICKS(100))==pdTRUE) {
            portENTER_CRITICAL(&wifi_lock); online=event==1; portEXIT_CRITICAL(&wifi_lock);
            if(event) ambi_reconnect_up(&state); else ambi_reconnect_lost(&state,esp_timer_get_time()/1000);
        }
        if(ambi_reconnect_due(&state,esp_timer_get_time()/1000)) esp_wifi_connect();
    }
}
esp_err_t ambi_wifi_start(const ambi_config_t *c) {
    if(!c->ssid[0]) return ESP_ERR_INVALID_ARG;
    ESP_RETURN_ON_ERROR(esp_netif_init(),"wifi","netif");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(),"wifi","event loop");
    if(!esp_netif_create_default_wifi_sta()) return ESP_ERR_NO_MEM;
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&init),"wifi","init");
    events=xQueueCreate(1,sizeof(int)); if(!events)return ESP_ERR_NO_MEM;
    ESP_RETURN_ON_ERROR(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,event_handler,NULL),"wifi","handler");
    ESP_RETURN_ON_ERROR(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,event_handler,NULL),"wifi","IP handler");
    wifi_config_t wifi={0}; memcpy(wifi.sta.ssid,c->ssid,strlen(c->ssid)); memcpy(wifi.sta.password,c->password,strlen(c->password));
    wifi.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK;
    ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM),"wifi","storage");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA),"wifi","mode");
    ESP_RETURN_ON_ERROR(esp_wifi_set_config(WIFI_IF_STA,&wifi),"wifi","config");
    if(xTaskCreate(reconnect_task,"ambi_wifi",4096,NULL,3,NULL)!=pdPASS)return ESP_ERR_NO_MEM;
    return esp_wifi_start();
}
