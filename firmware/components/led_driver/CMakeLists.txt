idf_component_register(SRCS "led_driver.c"
    INCLUDE_DIRS "." REQUIRES configuration led_strip esp_driver_spi)
