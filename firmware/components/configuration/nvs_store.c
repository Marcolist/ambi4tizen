#include "ambi_config.h"
#include "nvs.h"
#include "nvs_flash.h"
esp_err_t configuration_load(const ambi_config_t *defaults,ambi_config_t *out) {
    *out=*defaults;
    esp_err_t err=nvs_flash_init(); if(err!=ESP_OK) return err; /* Never erase other namespaces. */
    nvs_handle_t h; err=nvs_open("ambilight",NVS_READONLY,&h);
    if(err==ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
    if(err!=ESP_OK) return err;
    uint8_t data[AMBI_CONFIG_BYTES]; size_t size=sizeof(data);
    err=nvs_get_blob(h,"config",data,&size); nvs_close(h);
    if(err==ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
    if(err!=ESP_OK) return err;
    ambi_config_t saved;
    if(!ambi_config_decode(data,size,&saved)) return ESP_ERR_INVALID_CRC;
    if(saved.profile_id==defaults->profile_id) *out=saved;
    return ESP_OK;
}
esp_err_t configuration_save(const ambi_config_t *c) {
    uint8_t data[AMBI_CONFIG_BYTES]; if(!ambi_config_encode(c,data)) return ESP_ERR_INVALID_ARG;
    nvs_handle_t h; esp_err_t err=nvs_open("ambilight",NVS_READWRITE,&h); if(err!=ESP_OK)return err;
    err=nvs_set_blob(h,"config",data,sizeof(data)); if(err==ESP_OK)err=nvs_commit(h); nvs_close(h); return err;
}
