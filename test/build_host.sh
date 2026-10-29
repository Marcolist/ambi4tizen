#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test/build
parts=(ambilight_receiver configuration color_engine mode_manager led_driver)
includes=()
for part in "${parts[@]}"; do includes+=("-Ifirmware/components/$part"); done
shared=(firmware/components/ambilight_receiver/{protocol,auth,reconnect}.c firmware/components/configuration/configuration.c firmware/components/color_engine/color_engine.c firmware/components/mode_manager/mode_manager.c)
flags=(-std=c11 -Wall -Wextra -Werror -g -O1 "${includes[@]}")
gcc "${flags[@]}" -fsanitize=address,undefined -fno-omit-frame-pointer -fno-pie -no-pie "${shared[@]}" firmware/test/test_core.c -lm -lcrypto -o test/build/test_core
gcc "${flags[@]}" "${shared[@]}" tools/receiver_sim.c -lm -lcrypto -o test/build/receiver_sim
ASAN_OPTIONS=detect_leaks=1 test/build/test_core
gcc "${flags[@]}" -fsanitize=address,undefined -fno-omit-frame-pointer -fno-pie -no-pie firmware/components/configuration/configuration.c firmware/components/color_engine/color_engine.c firmware/test/test_adaptive.c -lm -o test/build/test_adaptive
ASAN_OPTIONS=detect_leaks=1 test/build/test_adaptive
gcc "${flags[@]}" -DESP_PLATFORM -Ifirmware/test/stubs -fsanitize=address,undefined -fno-pie -no-pie firmware/components/configuration/{configuration,nvs_store}.c firmware/test/test_nvs.c -o test/build/test_nvs
ASAN_OPTIONS=detect_leaks=1 test/build/test_nvs
