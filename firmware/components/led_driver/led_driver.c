#include "ambi_led.h"
#include "led_strip.h"
#include "driver/spi_master.h"
#include "sdkconfig.h"
#include "gpio_policy.h"
static led_strip_handle_t strip;
static unsigned length;
static bool safe_gpio(int pin) {
#if CONFIG_IDF_TARGET_ESP32S3
    return ambi_gpio_allowed(pin, true);
#elif CONFIG_IDF_TARGET_ESP32
    return ambi_gpio_allowed(pin, false);
#else
    return false;
#endif
}
esp_err_t ambi_led_init(const ambi_config_t *c) {
    if(!c->output_enabled) return ESP_OK;
    if(!safe_gpio(c->gpio) || !ambi_config_validate(c)) return ESP_ERR_INVALID_ARG;
    led_strip_config_t cfg={.strip_gpio_num=c->gpio,.max_leds=ambi_led_count(c),
        .led_model=LED_MODEL_WS2812,.color_component_format=LED_STRIP_COLOR_COMPONENT_FMT_GRB};
    led_strip_spi_config_t spi={.spi_bus=SPI2_HOST,.flags.with_dma=true};
    esp_err_t err=led_strip_new_spi_device(&cfg,&spi,&strip);
    if(err!=ESP_OK)return err;
    length=ambi_led_count(c); err=led_strip_clear(strip);
    if(err!=ESP_OK) { ambi_led_stop(); }
    return err;
}
bool ambi_led_ready(void) { return strip!=NULL; }
esp_err_t ambi_led_write(const ambi_rgb_t *pixels,unsigned count) {
    if(!strip)return ESP_OK;
    if(count!=length)return ESP_ERR_INVALID_SIZE;
    for(unsigned i=0;i<count;i++) {
        esp_err_t err=led_strip_set_pixel(strip,i,pixels[i].r,pixels[i].g,pixels[i].b);
        if(err!=ESP_OK)return err;
    }
    return led_strip_refresh(strip);
}
void ambi_led_stop(void) {
    if(strip) { led_strip_clear(strip); led_strip_del(strip); strip=NULL; length=0; }
}
