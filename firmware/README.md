# ESP32 receiver firmware

The **classic ESP32 Arduino / Adafruit NeoPixel build** passed a visible weak-red
test with 83 LEDs on GPIO18 on November 8, 2026. It uses the same pinned platform,
library and initialization sequence as [EspMoveLamp](https://github.com/Marcolist/EspMoveLamp):
PlatformIO **espressif32 6.9.0**, Arduino framework and **Adafruit NeoPixel 1.12.3**,
`NEO_GRB + NEO_KHZ800`. The receiver also accepts live authenticated TV frames;
visual matching during full live playback remains a separate check.

The alternative ESP-IDF build supports classic ESP32 and ESP32-S3 with
**ESP-IDF 5.5.6 / led_strip 3.1.1**, but its SPI output has not passed a visible
strip test on this setup. Earlier S3 diagnostics only established software
initialization and network behavior, not a working physical LED receiver.

## Architecture

| Module | Purpose |
| --- | --- |
| `ambilight_receiver` | Wi-Fi, reconnect, UDP, HMAC, ordering/freshness and a one-frame queue |
| `color_engine` | U-shaped mapping, corner interpolation, time-based smoothing, gamma, brightness and estimated current limiting |
| `mode_manager` | OFF, AMBILIGHT, AMBIENT, AUTO and manual priority |
| `configuration` | Validated settings, versioned CRC blob and a dedicated NVS namespace |
| `led_driver` | Arduino: Adafruit NeoPixel; ESP-IDF alternative: SPI with DMA |
| `diagnostics` | Authenticated status requests and manual commands |
| `main` | Single owner for modes/settings and a 20-ms output loop |

The Arduino adapter reuses the existing C receiver, color engine, NVS and API.
Only the entry point and LED backend change. Adafruit NeoPixel uses its classic
ESP32 RMT implementation on this pinned Arduino platform.

For the alternative ESP-IDF backend, SPI2 is reserved entirely for the LED strip. Only its data line is needed; the
strip does not need a separate clock wire. DMA avoids the classic ESP32's
RMT interrupt load when Wi-Fi is active. GPIO initialization requires validated
configuration and explicit `output_enabled`. Defaults: disabled, GPIO −1, zero LEDs.

For the ESP-IDF backend, initialization and the first black output must succeed;
otherwise the driver is released. A later reported output error triggers a best-effort black output and stops
the driver while networking/diagnostics remain active. A broken data connection
cannot reliably clear colors already latched by LEDs. Software OFF is not an
electrical power disconnect. The Adafruit `show()` API returns no transmission
result; its ready flag confirms allocation/initialization, not measured output.

## Build locally

### Tested classic ESP32 Arduino build

Install PlatformIO Core. Configure `.local/ambilight-config.json` as described
below, with `target="esp32"`, then prepare and build:

```sh
python3 tools/prepare_arduino.py
pio run -d .local/arduino-receiver
```

The preparation tool copies the portable production components and Arduino
adapter into an ignored private project. It generates credentials there with
permissions 0600, leaves the TV package untouched and never accesses hardware.
Run preparation again after configuration or source changes. The compiled
startup mode is OFF; valid existing NVS settings still take priority. Changing
`profile_id` applies the new compiled defaults on the next boot.

Before flashing, disconnect the strip and external supply, identify the chip
and MAC on the **specific USB adapter**, and back up the existing flash. With
multiple ESP devices attached, confirm the physical role by unplugging only
the intended board and checking which adapter disappears. An adapter name or
`/dev/ttyUSB0` alone is not sufficient identification.

For a fresh, verified classic ESP32 board, PlatformIO can install the complete
image using an explicit stable device path:

```sh
pio run -d .local/arduino-receiver -t upload --upload-port /dev/serial/by-id/REPLACE_WITH_VERIFIED_ADAPTER
```

This may replace the partition table. For an existing Ambi4Tizen installation,
use an application-only update at `0x10000` **only after verifying** that its
active application partition starts there and is large enough for the new
image. Preserve bootloader, partition table and NVS; do not apply the default
PlatformIO partition layout blindly. Never flash this classic ESP32 image to
an ESP32-S3 or another attached display/controller.

After USB-only flashing, power down before reconnecting the strip. Begin with
a dim static color; use the external supply directly for the full strip, with
common GND. The ESP USB/5V pin is not a supply path for a full-brightness strip.
Confirm physical light output and then enable AUTO. A successful `show()` or
`led_ready=true` does not measure the actual data signal or prove visible light.

### Alternative ESP-IDF build

Install official ESP-IDF 5.5.6 with the ESP32 tools. If installed under the
ignored `.local/` directory, use:

```sh
export IDF_TOOLS_PATH="$PWD/.local/espressif"
. .local/esp-idf-v5.5.6/export.sh
idf.py -C firmware build
```

A fresh checkout can also use a normal installation of this SDK version.
`sdkconfig.defaults` selects ESP32/4-MB flash. Confirm the actual module,
flash capacity and board pinout **before flashing**. Set the private top-level
`target` to `esp32` (default) or `esp32s3` to match the detected chip. The
configuration generator and driver use target-specific GPIO candidates; the
generated header rejects an SDK target mismatch. This does not select the SDK
target automatically. For S3, use a separate ignored build project configured
with `idf.py set-target esp32s3` and the verified flash capacity; do not flash
classic ESP32 images to an S3 or assume every S3 board has the same pinout. Generated `sdkconfig`,
build files, SDKs and binaries are ignored. Automated checks do not flash or
open a serial monitor.

## Private configuration

```sh
python3 tools/configure.py --init
# Edit .local/ambilight-config.json locally.
python3 tools/configure.py
# Rebuild afterward; do not flash before hardware review.
```

`--init` creates a random UDP key, API token and profile ID, preserves existing
credentials and leaves sender/LED output disabled. Keep Wi-Fi credentials in
this local file, never in Git or chat. `configure.py` generates
`main/private_config.h`, also ignored. If the header is added after the first
build, reconfigure CMake with `idf.py -C firmware reconfigure build`.

Set the Wi-Fi SSID/password, TV IPv4 address, later the ESP IPv4 address, actual
LED counts for left/top/right, verified data GPIO, current budget and brightness
cap. A nonempty layout must include all three sides. The total can be 3–600;
this is a software limit, not a power-supply rating. No fixed frame LED count
is built into the program.

Mapping runs from the bottom left upward, across the top and down the right,
looking at the screen from the front. For LED 0 at bottom right going up the
right side, left across the top and down the left, use `reverse=true` and
`start_offset=total_leds-1`. This routing must be physically confirmed.
`start_offset` identifies the physical
LED index at that starting point; `reverse` reverses the physical direction.
Interpolation respects section lengths and blends corners without bridging
the unlit bottom. Establish direction with a few dim test points.

`gamma_milli=2200` means `pow(channel/255, 2.2)`. Temporal smoothing is adaptive:
normal changes use up to 80 ms, broad large palette changes up to 25 ms.
The existing `smoothing_ms` is an upper bound; zero disables smoothing, while
AMBIENT keeps its configured time constant. OFF resets the filter and palette
reference. This is a border-color heuristic, not semantic scene recognition.
See [adaptive transitions](../docs/adaptive-smoothing.md) for thresholds,
diagnostics and limits. Brightness is the
minimum of the manual setting, local cap and optional TV packet value. The TV
cannot raise the local cap.

`current_limit_ma` estimates load from RGB output, configurable 60 mA per white
LED and 1 mA idle per LED, including OFF. Actual variants can differ. Idle load
still physically exists when the budget is too low. This estimate replaces
neither a suitable supply nor fuse/wiring checks. The 500-mA default is not a
guaranteed supply or wiring rating.

## Modes and persistence

| Selected mode | Behavior |
| --- | --- |
| OFF | Immediate black; Wi-Fi/HTTP stay reachable and UDP cannot override OFF |
| AMBILIGHT | Current TV colors; black after `timeout_ms` without data |
| AMBIENT | Saved static RGB color, independent of the TV |
| AUTO | Valid stream → Ambilight; timeout → saved ambient state or OFF |

Manual OFF and AMBIENT override the stream. Explicitly select AUTO to resume
automatic switching. AMBIENT saves the ambient state as on; OFF saves it as off.
An RGB command changes the saved ambient color, but OFF retains priority until
the mode is changed.

Manual changes are saved to NVS before being applied. Frames are never stored,
avoiding repeated flash writes. On an NVS write failure the previous setting
remains active; `/status.last_error` reports the failure. Invalid NVS content at
startup disables LED output. No automatic NVS erase or changes to unrelated
namespaces are performed. A changed private `profile_id` replaces previous
settings with compiled defaults on the next startup. Choose a new ID when
changing network/pin/layout settings. Prototype credentials are unencrypted
inside private images/NVS; never publish those images or generated headers.

## Diagnostics and control

ESP HTTP port 8080 provides `GET /status` and `POST /command`. Both require
`Authorization: Bearer <private token>`. Status contains no passwords/keys.
Use only on a trusted LAN: HTTP is unencrypted. Do not forward this port.
The Wi-Fi station requires at least WPA2; open networks are not supported.
The USB/mains-powered receiver disables modem sleep to avoid DTIM-related
receive latency. This increases radio power use; it does not guarantee delivery.

After hardware review and commissioning:

```sh
python3 tools/controller.py status
python3 tools/controller.py AMBIENT --rgb 255 120 30 --brightness 24
python3 tools/controller.py AUTO
python3 tools/controller.py OFF
```

`/command` accepts only `mode`, `brightness` and/or `ambient`. HTTP 202 confirms
entry into the bounded command queue. Check status afterward and avoid frequent
writes. This endpoint cannot change network settings, GPIO or output enable.
The same command structure is the intended entry point for a future Zigbee adapter.

Status reports `led_backend`, receive counters, invalid/stale packets, Wi-Fi state, free/minimum
heap, mode, LED driver state and estimated current. Driver state does not prove
that a physical strip is attached or visibly responding.
The adaptive firmware also reports `color_algorithm`, selected `smoothing_ms`,
`fast_transition` and the `scene_changes` count since boot.

## Evidence and remaining tests

`bash test/run_all.sh` checks portable production modules under ASan/UBSan,
the NVS adapter against a failure-injecting memory stub and the TV sender chain
over actual UDP loopback. See the [test guide](../test/README.md). Wi-Fi
reconnection and NVS across a physical restart passed on one S3 receiver with
output disabled. A classic ESP32 with the Arduino NeoPixel backend subsequently
passed a user-observed 83-pixel weak-red test. Live color mapping, flicker,
latency, long-duration operation and other strip variants need separate checks.
Hardware/TV checks: [test plan](../docs/esp32-hardware-test.txt).

Portable components can be reused for ESP32-C6. Pins, SPI driver, SDK version
and radio coexistence require separate validation. No C6 build or Zigbee/Hue
integration has been implemented.

Driver/SDK sources:
[ESP-IDF 5.5.6](https://github.com/espressif/esp-idf/releases/tag/v5.5.6),
[Espressif LED Strip 3.1.1](https://components.espressif.com/components/espressif/led_strip/versions/3.1.1/readme).

S3 GPIO reservations: [Espressif GPIO documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html).
The conservative candidate list excludes strapping, flash/PSRAM (including
octal-memory pins), native USB and the UART0 diagnostic pins. Board-specific
onboard devices may reserve additional pins; the list is not wiring approval.
