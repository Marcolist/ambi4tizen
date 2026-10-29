#include "ambi_config.h"
#include "nvs.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static uint8_t stored[AMBI_CONFIG_BYTES],pending[AMBI_CONFIG_BYTES];
static bool exists;
static int init_error,commit_error,set_error;
esp_err_t nvs_flash_init(void){return init_error;}
esp_err_t nvs_open(const char *name,int mode,nvs_handle_t *h){assert(!strcmp(name,"ambilight"));*h=1;return (!exists && mode==NVS_READONLY)?ESP_ERR_NVS_NOT_FOUND:ESP_OK;}
esp_err_t nvs_get_blob(nvs_handle_t h,const char *name,void *out,size_t *size){assert(h==1 && !strcmp(name,"config") && *size==sizeof(stored));memcpy(out,stored,*size);return ESP_OK;}
esp_err_t nvs_set_blob(nvs_handle_t h,const char *name,const void *data,size_t size){assert(h==1 && !strcmp(name,"config") && size==sizeof(pending));memcpy(pending,data,size);return set_error;}
esp_err_t nvs_commit(nvs_handle_t h){assert(h==1);if(!commit_error){memcpy(stored,pending,sizeof(stored));exists=true;}return commit_error;}
void nvs_close(nvs_handle_t h){assert(h==1);}
int main(void) {
    ambi_config_t defaults,saved,restored;ambi_config_defaults(&defaults);defaults.profile_id=100;
    assert(configuration_load(&defaults,&restored)==ESP_OK && restored.profile_id==100);
    saved=defaults;saved.brightness=17;saved.mode=AMBI_AMBIENT;saved.ambient_on=true;saved.ambient=(ambi_rgb_t){10,20,30};
    assert(configuration_save(&saved)==ESP_OK);
    assert(configuration_load(&defaults,&restored)==ESP_OK && restored.brightness==17 && restored.mode==AMBI_AMBIENT && restored.ambient.g==20);
    commit_error=ESP_FAIL;saved.brightness=19;assert(configuration_save(&saved)==ESP_FAIL);commit_error=0;
    assert(configuration_load(&defaults,&restored)==ESP_OK && restored.brightness==17);
    set_error=ESP_FAIL;assert(configuration_save(&saved)==ESP_FAIL);set_error=0;
    defaults.profile_id=101;assert(configuration_load(&defaults,&restored)==ESP_OK && restored.brightness==defaults.brightness);
    stored[100]^=1;assert(configuration_load(&defaults,&restored)==ESP_ERR_INVALID_CRC && !restored.output_enabled);
    init_error=ESP_FAIL;assert(configuration_load(&defaults,&restored)==ESP_FAIL);
    puts("PASS NVS adapter: save/reload, profile replacement, corruption, commit/set/init failures; no erase API linked");
}
