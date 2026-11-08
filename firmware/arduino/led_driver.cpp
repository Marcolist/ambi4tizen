#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
extern "C" {
#include "ambi_led.h"
#include "gpio_policy.h"
}

static Adafruit_NeoPixel strip;
static unsigned length;
static bool ready;

extern "C" const char *ambi_led_backend(void) { return "adafruit-neopixel-1.12.3"; }

extern "C" esp_err_t ambi_led_init(const ambi_config_t *c) {
    if (!c->output_enabled) return ESP_OK;
    if (!ambi_gpio_allowed(c->gpio, false) || !ambi_config_validate(c)) return ESP_ERR_INVALID_ARG;
    // Initialization and pinned dependency follow the tested EspMoveLamp receiver.
    strip.updateType(NEO_GRB + NEO_KHZ800);
    strip.updateLength(ambi_led_count(c));
    strip.setPin(c->gpio);
    if (strip.numPixels() != ambi_led_count(c) || !strip.getPixels()) return ESP_ERR_NO_MEM;
    strip.begin();
    strip.clear();
    strip.show();
    length = ambi_led_count(c);
    ready = true;
    return ESP_OK;
}

extern "C" bool ambi_led_ready(void) { return ready; }

extern "C" esp_err_t ambi_led_write(const ambi_rgb_t *pixels, unsigned count) {
    if (!ready) return ESP_OK;
    if (count != length) return ESP_ERR_INVALID_SIZE;
    for (unsigned i = 0; i < count; ++i)
        strip.setPixelColor(i, pixels[i].r, pixels[i].g, pixels[i].b);
    strip.show();
    return ESP_OK;
}

extern "C" void ambi_led_stop(void) {
    if (ready) { strip.clear(); strip.show(); ready = false; }
}
