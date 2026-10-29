idf_component_register(SRCS "configuration.c" "nvs_store.c"
    INCLUDE_DIRS "." "../ambilight_receiver" REQUIRES nvs_flash)
