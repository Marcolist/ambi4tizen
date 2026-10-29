# ESP32 / ESP32-S3 prototype

The firmware builds for the classic ESP32 and ESP32-S3 using **ESP-IDF 5.5.6**.
`espressif/led_strip` is pinned to **3.1.1**; `dependencies.lock` records the
resolved dependency. An ESP32-S3 was flashed with LED output disabled: Wi-Fi,
authenticated HTTP, TV UDP reception and manual OFF persistence across physical
restart passed. A later S3 image also initialized the GPIO18 driver for 91 pixels
without a connected strip, and restored saved OFF across a physical restart.
It includes the rolling freshness reference and disabled Wi-Fi modem sleep.
Physical LED output remains untested.

## Architecture

| Module | Purpose |
| --- | --- |
| `ambilight_receiver` | Wi-Fi, reconnect, UDP, HMAC, ordering/freshness and a one-frame queue |
| `color_engine` | U-shaped mapping, corner interpolation, time-based smoothing, gamma, brightness and estimated current limiting |
| `mode_manager` | OFF, AMBILIGHT, AMBIENT, AUTO and manual priority |
| `configuration` | Validated settings, versioned CRC blob and a dedicated NVS namespace |
| `led_driver` | WS2812/GRB through Espressif's SPI driver with DMA |
| `diagnostics` | Authenticated status requests and manual commands |
| `main` | Single owner for modes/settings and a 20-ms output loop |

SPI2 is reserved entirely for the LED strip. Only its data line is needed; the
strip does not need a separate clock wire. DMA avoids the classic ESP32's
RMT interrupt load when Wi-Fi is active. GPIO initialization requires validated
configuration and explicit `output_enabled`. Defaults: disabled, GPIO −1, zero LEDs.

Initialization and the first black output must succeed; otherwise the driver
is released. A later output error triggers a best-effort black output and stops
the driver while networking/diagnostics remain active. A broken data connection
cannot reliably clear colors already latched by LEDs. Software OFF is not an
electrical power disconnect.

## Build locally

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

`gamma_milli=2200` means `pow(channel/255, 2.2)`. Smoothing is a time-based
exponential function with `smoothing_ms=150`; OFF resets it. Brightness is the
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

Status reports receive counters, invalid/stale packets, Wi-Fi state, free/minimum
heap, mode, LED driver state and estimated current. Driver state does not prove
that a physical strip is attached or visibly responding.

## Evidence and remaining tests

`bash test/run_all.sh` checks portable production modules under ASan/UBSan,
the NVS adapter against a failure-injecting memory stub and the TV sender chain
over actual UDP loopback. See the [test guide](../test/README.md). Wi-Fi
reconnection and NVS across a physical restart passed on one S3 receiver with
output disabled. GPIO timing, LED wiring and visible output remain untested.
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
