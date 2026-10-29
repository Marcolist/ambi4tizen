# Live-test preparation

The TV sender supports explicit continuous operation with
`sender.duration_ms=0`. Rebuild, reinstall and launch after changing that private
setting. Start with 12 zones, 480×270 and a 1000-ms interval. The ESP expands
zones to the configured LED count; 91 LEDs do not require 91 capture zones.
There is no automatic TV boot startup. Normal stop/error handling still applies.

## Front-view bottom-right start

For LED 0 at the **bottom right when looking at the screen from the front**,
with the data arrow going up the right side, left across the top and down the
left side:

| Setting | Value |
| --- | --- |
| `leds_right`, `leds_top`, `leds_left` | Actual counted LEDs on each installed section |
| `reverse` | `true` |
| `start_offset` | `leds_left + leds_top + leds_right - 1` |

This is a three-sided U. A bottom edge is not currently sampled or mapped.
Check the strip's DIN/data-arrow direction; changing the software direction
does not turn a strip's DOUT connector into an input.

A nominal 65-inch 16:9 image measures about 1.439 m × 0.809 m. At 30 LEDs/m,
a three-sided estimate is **24 right + 43 top + 24 left = 91 LEDs**, or about
3.03 m of strip. For that example the start offset is 90. These are planning
numbers, not measured installation dimensions. Inset mounting, corners,
connectors and cut points change the required lengths. Measure the actual path
and count each side before cutting or enabling output. Do not place spare
connected LEDs across the bottom and expect this U mapping to account for them.

## Power and wiring before output

Confirm the exact strip marking/protocol/voltage, power-supply output current,
data GPIO and board pinout, common ground, level shifting, fuse and wire ratings.
The GPIO candidate list only excludes known chip reservations; onboard devices
can reserve further pins. An ESP32-S3 is not pin-compatible with a classic ESP32.
The first flashed receiver keeps output disabled, GPIO −1 and zero LEDs.

Using the conservative **60 mA per full-white LED assumption**, 91 LEDs need
about **5.46 A / 27.3 W at 5 V**, before controller consumption and headroom.
Use the actual strip datasheet to size the supply, wiring, fuse and power
injection. A label saying only “5 V” does not establish available current.
The strip's supply current must not pass through the ESP board's USB connector
or GPIO pins. Avoid backfeeding an external 5-V supply into computer USB.

For a reviewed board with GPIO18 available, the three separate connections are:

| Connection | Destination |
| --- | --- |
| Supply +5 V | Strip +5 V; do not route strip power through the ESP |
| Supply GND | Strip GND and ESP GND (common signal reference) |
| ESP GPIO18 | Strip DIN, preferably through a suitable 3.3-V-to-5-V logic buffer |

Power down both supplies while wiring. Do not connect external +5 V to the
ESP's 3.3-V pin or any GPIO. Direct 3.3-V data into a 5-V strip may be unreliable;
check the exact strip's input threshold. Supply capacity alone does not establish
safe wire/fuse ratings. Keep the GPIO/data lead short and verify DIN rather than
DOUT. This example assumes a compatible, individually addressable WS2812B/GRB
strip; voltage and LED density alone do not identify its protocol.

After verifying power and wiring, full-brightness operation can use
`brightness=255` and `brightness_cap=255`. With 91 LEDs, `white_pixel_ma=60`
and `current_limit_ma=6000`, the estimator allows full RGB white without scaling
(about 5551 mA including its idle allowance). This remains an estimate, not a
current measurement or short-circuit protection.

Start with a few dim points, verify right/top/left orientation and the first
LED, then test a low-brightness moving pattern before TV colors. Keep the
initial brightness cap low. Full-white/full-brightness output requires verified
power and wiring; the software current estimate is not electrical protection.

Changing the compiled GPIO/layout requires a deliberate receiver rebuild and
flash with the correct chip/flash target. Use a new private `profile_id` so that
previous NVS settings do not silently retain the old disabled layout. Preserve
the existing flash backup. Do not reset or flash a connected board until the
wiring has been reviewed or the strip and external supply are disconnected.

## Evidence and limits

A first bounded hardware test delivered 30/30 authenticated frames from the TV
to an ESP32-S3 over Wi-Fi, with no invalid or stale packets. The LED driver was
disabled. Wi-Fi reconnect and saved OFF across physical restart passed.

Continuous sender tests exercise manual shutdown, capture/cleanup/socket errors,
the optional deadline and service expiry using virtual time under Node 4.4.3.
Receiver tests simulate about 69 days of relative clock drift and capture-clock
wrap. These checks do not establish that a TV service will remain alive for
days or that LEDs visibly work. The latest receiver source changes require a
separate receiver update; installing the TV app does not flash the ESP.

A subsequent continuous live run remained active for several minutes at about
one frame per second with no sender errors. Some packets were rejected by the
receiver's freshness gate; sustained loss-free delivery has not been shown.
The next receiver build disables Wi-Fi modem sleep to avoid DTIM-related
receive latency, at the cost of higher radio power use. Whether this improves
the observed drops still needs a live comparison after flashing.

For a live check compare TV sent counts with ESP accepted counts beyond the old
30-second window, inspect errors and memory, and confirm playback separately.
Leave diagnostics private. Stop the sender if playback becomes unstable.
