idf_component_register(SRCS "diagnostics.c"
    INCLUDE_DIRS "." REQUIRES ambilight_receiver led_driver esp_http_server json)
