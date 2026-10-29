idf_component_register(SRCS "protocol.c" "auth.c" "reconnect.c" "udp_receiver.c" "wifi.c"
    INCLUDE_DIRS "." REQUIRES configuration mbedtls esp_wifi esp_netif esp_event esp_timer)
