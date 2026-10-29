idf_component_register(SRCS "main.c" INCLUDE_DIRS "."
    REQUIRES led_driver ambilight_receiver color_engine mode_manager configuration diagnostics esp_timer)
if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/private_config.h")
    target_compile_definitions(${COMPONENT_LIB} PRIVATE AMBI_PRIVATE_CONFIG=1)
endif()
