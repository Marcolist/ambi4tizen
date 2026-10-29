# Ambi4Tizen

**Native TV colors. Local light.**

An experimental Ambilight prototype for Samsung TVs running **Tizen 4.0** and
an **ESP32 / ESP32-S3** receiver intended to drive WS2812B LEDs. The “4” means both “for” and Tizen 4.

```text
Internal TV app → TV-side capture → RGB edge zones → Wi-Fi/UDP → ESP32 → LEDs
```

The TV processes its own image. Only averaged colors are transmitted, never
video frames or JPEGs. The intended operating chain needs no permanent PC
service, HDMI capture device, external streaming client or cloud service.

## Risk, warranty and liability

**Experimental software — use at your own risk.** Installing, configuring,
flashing or running this project may cause unexpected behavior, interrupted
service, data loss or damage to TVs, controllers, LED strips, power supplies
or other connected equipment. Verify your device, wiring and power requirements
before any hardware test.

The project is supplied **as is**, with no guarantees of safety, reliability,
compatibility or suitability for your setup. To the maximum extent permitted
by applicable law, the authors, contributors and copyright holders accept no
liability for damage, loss, claims or costs resulting from this project or its
documentation. This notice does not exclude liability that cannot legally be
excluded or restrict mandatory statutory rights.

See the [MIT license](LICENSE) for the full warranty disclaimer and liability terms.

## Project status

| Component | Status |
| --- | --- |
| Existing capture prototype | Successful bounded single-frame tests on UE65NU7179, Tizen 4.0 / ARMv7, firmware 1360 |
| Internal streaming apps | Changing colors in limited Netflix, Prime Video and Disney+ tests; no universal codec/HDR guarantee |
| New TV sender | Node 4.4.3 / UDP loopback tested; first bounded hardware run delivered 30/30 authenticated frames; continuous mode available, long-term reliability unverified |
| ESP32 firmware | Classic ESP32 and ESP32-S3 builds using ESP-IDF 5.5.6 / led_strip 3.1.1; S3 flashed, networking/NVS restart and 91-pixel driver initialization tested without connected LEDs |
| Visible end-to-end test | Pending; a complete TV-to-LED solution has not yet been demonstrated |
| Boot startup / ESP32-C6 / Zigbee / Hue | Later phases, not implemented or confirmed |

The TV sender and LED output are disabled by default. The software uses an
existing Samsung capture service that is not publicly documented. Other models
and firmware versions are untested. No root access, firmware modifications,
system-file changes or DRM bypass are part of this project.

## Run local tests without a TV or LEDs

Requirements: GCC, OpenSSL development libraries, Python 3, Pillow and Node.
Tests use loopback networking, synthetic images and memory stubs.

```bash
git clone https://github.com/Marcolist/ambi4tizen.git
cd ambi4tizen
python3 -m venv .local/test-venv
.local/test-venv/bin/pip install -r test/requirements.txt
PATH="$PWD/.local/test-venv/bin:$PATH" bash test/run_all.sh
```

Tests cover the protocol/HMAC, malformed and stale packets, LED mapping, corner
interpolation, gamma, smoothing, modes, timeouts, reconnect logic, persistence
and the actual Node → UDP → C receiver chain. An additional Node 4.4.3 run is
performed when that runtime is available as described in
[test/README.md](test/README.md). A skipped compatibility run is reported explicitly.

## 1. Prepare the TV development tools

The build scripts expect these local tools:

| Tool | Tested version / expected path |
| --- | --- |
| Samsung SDB | 4.2.36, `discovery/tools/sdb-sdk/tools/sdb` |
| .NET SDK for signing | 6.0.428, `.local/dotnet/dotnet` |
| SDK signing task | `Tizen.NET.Sdk` 1.1.9, `tools/WidgetSigner.proj` |

SDKs and certificates are not included or installed automatically. Configure
Tizen signing tools and appropriate certificates locally. The signing task does
not compile a .NET application for the TV. Acceptance of a development package
on one device does not guarantee acceptance on other devices or in an app store.

The TV and computer must be reachable on the same LAN. Developer Mode and the
computer's IP address must be configured on the TV. For initial setup, open
Apps/App Settings, enter `12345`, enable Developer Mode, enter the computer's
IP address and perform the requested restart. Menu locations can vary. See
[Samsung – TV Device](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
This installation procedure does not require a firmware update.

## 2. Select and verify the target TV

Use only a device you control. Run the following commands from the repository
root. If configuration already exists, do not delete it or regenerate credentials.

```bash
read -r -p "Target TV IPv4 address: " TV_IP
read -r -p "This computer's LAN IPv4 address: " DEVELOPER_IP
python3 poc/configure_probe.py --tv "$TV_IP" --host "$DEVELOPER_IP"
```

The tool reads the TV identity and saves it in `.local/target.json`. It does not
overwrite configuration or change TV settings. Verify the device name, model
and MAC locally before installing an app. These values remain private.

```bash
TV_IP="$(python3 -c 'import json; print(json.load(open(".local/target.json"))["host"])')"
SDB_BIN="discovery/tools/sdb-sdk/tools/sdb"
"$SDB_BIN" connect "${TV_IP}:26101"
"$SDB_BIN" -s "${TV_IP}:26101" get-state
```

The expected state is `device`. Stop on an identity mismatch or connection
failure. Do not try unrelated devices or remove the identity checks.

## 3. Configure the private sender settings

Run once during initial setup:

```bash
python3 tools/configure.py --init
```

The generated `.local/ambilight-config.json` contains a random UDP key, API token
and profile ID. It is excluded from Git. **Do not publish real addresses, MACs,
Wi-Fi credentials, keys or generated packages.**

For an installation without capture, first set `firmware.source_ip` to the TV
address in `.local/target.json`. Keep `sender.enabled=false` and
`firmware.output_enabled=false`. This produces an installable package that does
not capture images or open the sender diagnostics port.

Before an active test, also configure these values locally:

| Setting | Meaning |
| --- | --- |
| `target` | Detected chip: `esp32` or `esp32s3`; match the SDK target separately |
| `firmware.ssid`, `firmware.password` | Wi-Fi credentials for the ESP |
| `sender.esp_ip` | Actual ESP IPv4 address, not a placeholder or broadcast address |
| `sender.developer_ip` | Computer IP allowed to request status/stop |
| `firmware.udp_port`, `sender.port` | Matching UDP port; default 19446 |
| `sender.zones` | 6, 12, 18 or 24; default 12 |
| `sender.resolution` | Initially `480x270` |
| `sender.interval_ms` | Initially `1000` |
| `sender.duration_ms` | Initially `30000`; `0` explicitly selects continuous operation |

Set `sender.enabled=true` only before a deliberate active test. **Every TV
configuration change requires rebuilding and reinstalling the package.** The
TV does not continuously read the JSON file on the computer. ESP configuration
and verified wiring are separate steps: [firmware guide](firmware/README.md),
[hardware checklist](docs/esp32-hardware-test.txt).

## 4. Build and install the TV app

```bash
python3 tools/build_sender.py
python3 poc/deploy_web_probe.py install --sender --context "Installation without capture startup"
```

The builder signs `poc/build/ambilight-sender.wgt`. The installer checks the
identity and Developer Mode, then installs this project's sender package.
`install` does not start a capture run. The optional diagnostic app is separate.

Application identifiers:

| Identifier | Purpose |
| --- | --- |
| `ambiSend40` | Package |
| `ambiSend40.Start` | “Ambilight Sender” launcher app |
| `ambiSend40.Service` | Background service |

```bash
"$SDB_BIN" -s "${TV_IP}:26101" shell 0 applist
```

Check for `install completed` in the installation log and both application IDs
in the inventory. Private installation logs are stored under `poc/runtime/`.
Internal package identifiers remain unchanged for update compatibility.

## 5. Run a short test: start, status and stop

Prepare the receiver and verify the hardware first. Start small: 30 seconds,
12 zones, 480×270 and a target interval of one second.

```bash
python3 poc/deploy_web_probe.py launch --sender --context "Short 30-second test"
python3 poc/deploy_web_probe.py status --sender
python3 poc/deploy_web_probe.py stop --sender
```

`launch` starts the background service, `status` reads its diagnostics and `stop`
waits for an active capture to finish and clean up. The launcher rejects a
locally disabled sender configuration.

Alternatively, open “Ambilight Sender” in the TV's Apps menu. Its UI starts the
service and hides itself. A successful UI launch does not establish capture
success or a visible LED response.

After the test window, five seconds remain for reading status before the
service exits. `Connection refused` is normal when the service has ended or is
disabled. Verify installation using `applist`. No boot startup is configured.
Stop immediately if playback stutters or hangs; extend tests only after review.

## Continuous operation and LED preparation

After reviewing a short test, set `sender.duration_ms=0` locally, rebuild and
reinstall the TV app, then launch it as above. The default remains 30 seconds.
Zero removes both the sender deadline and the service expiry timer. Manual
stop, capture/cleanup errors, TV shutdown and operating-system termination can
still end the service. This does not configure startup when the TV turns on.
Once the service has exited, reopen the launcher or use the launch command to
start it again. If an error stops captures while diagnostics remain reachable,
use `stop --sender` before launching again.

Keep the initial interval at 1000 ms. Read `status --sender` and the ESP receive
counters after the previous 30-second limit to confirm actual continued
operation; `continuous=true` alone only identifies the configuration. An active
sender does not prove that LEDs are wired or responding. Receiver changes
require rebuilding and flashing the receiver separately; a TV app update cannot
update ESP firmware. The latest S3 test image includes the rolling freshness
reference and disabled Wi-Fi modem sleep, with physical LED output still pending.

See [live-test preparation](docs/live-test.md) for the bottom-right start,
30 LEDs/m estimates, power assumptions and the checks before enabling LEDs.

## 6. Uninstall

```bash
python3 poc/deploy_web_probe.py stop --sender
"$SDB_BIN" -s "${TV_IP}:26101" uninstall ambiSend40
"$SDB_BIN" -s "${TV_IP}:26101" shell 0 applist
```

Both sender IDs should disappear from the inventory. This uninstall procedure
has not yet been verified in practice. If the normal uninstaller refuses,
remove the app through the TV's app management UI; do not use force/root methods.
See [Samsung's troubleshooting guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).

## Documentation

| Document | Contents |
| --- | --- |
| [TV sender](tv/README.md) | Capture, profiling and limitations |
| [ESP32 firmware](firmware/README.md) | Modules, mapping, modes and build |
| [Tests and simulator](test/README.md) | Reproducible tests without a TV |
| [Protocol](protocol/README.md) | UDP format, authentication and freshness |
| [Project status](docs/esp32-prototype-status.txt) | Technical evidence and open questions |
| [Hardware test](docs/esp32-hardware-test.txt) | Power and wiring checks |
| [Live-test preparation](docs/live-test.md) | Continuous sender and front-view bottom-right LED mapping |
| [Future C6/Zigbee support](docs/esp32-c6-phase2.txt) | Prepared architecture and SDK review |
| [Capture diagnostic](poc/README.md) | Bounded baseline test |

## Privacy and license

This repository contains source code, general documentation and synthetic tests.
Device identities, addresses, credentials, certificates, SDKs, build products,
private investigations and viewing logs are excluded. Examples use loopback or
reserved documentation addresses. HMAC authenticates UDP colors but does not
encrypt them; diagnostic HTTP is also unencrypted.

Original project code: [MIT](LICENSE). Third-party code retains its own licenses
and attribution: [third-party notices](THIRD_PARTY_NOTICES.md).
Ambi4Tizen is independent of Samsung and Signify/Philips Hue.
