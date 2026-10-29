# Local tests without a TV or GPIO

```sh
bash test/run_all.sh
```

Requirements: GCC with ASan/UBSan, OpenSSL development libraries, Python 3,
Pillow and Node. If `.local/node-v4.4.3-linux-x64/bin/node` exists, the same TV
test also runs under Node 4.4.3. The host runtime used in validation was obtained
from nodejs.org and checked against its SHA256 list. It reproduces the TV's
Node API version, not its ARM CPU, sandbox or process lifecycle. If absent,
the suite explicitly reports the skipped compatibility run.

## Coverage

* Production C parser: HMAC, mutation at every byte position, truncation,
  invalid layout and 20,000 deterministically generated malformed packets.
* Stream state: sequence/timestamp wrap, duplicates, stale capture, added arrival
  delay, session takeover and replay.
* Production color engine: U order, start/direction as a bijection for
  3, 17, 81, 87, 123, 599 and 600 LEDs, corner interpolation, gamma endpoints/
  monotonicity, time-dependent smoothing, immediate OFF and limits.
* Mode manager: manual priority, both AUTO fallback states and timeout.
* Reconnect state machine: backoff, maximum interval, success and disconnect.
* Persistence: configuration codec/CRC and actual NVS adapter functions using
  a memory stub, including initialization/write/commit failures and profile change.
* Configuration tool: invalid values, disabled defaults, preservation of existing
  private credentials and correct C string encoding.
* Deployment wrapper with completely mocked I/O: disabled sender, incorrect
  source IP and mismatched TV identity prevent launch/installation.
* TV: actual JPEG decoder on a synthetic image, 6/12/18/24 zones, 200 capture
  evaluations per runtime, no overlapping captures, cleanup on broker/decoder/
  dimension/path errors and sender shutdown after three stale captures.
* Integration: actual Node sender/decoder → real loopback UDP → actual C parser,
  mode manager and color engine. An independent Python encoder checks language
  interoperability, alongside invalid authentication, oversized packets, stale
  captures, session lockout, duplicate rejection and timeout to OFF.

Tests inject the TV broker and temporary-file boundary; no TV is contacted.
Images and test keys are generated only in `test/output/`. The simulator binds
only to `127.0.0.1`. No serial ports, GPIO, router or Hue changes are involved.
Current Node versions emit a deprecation notice for the legacy Buffer
constructors required by Node 4 compatibility.

These checks do not replace real ESP radio reconnect, NVS after physical power
cycling, LED timing under Wi-Fi load or TV capture lifetime tests. Two hundred
fixture calls do not prove general memory-leak freedom on Tizen.

## Run the simulator manually

```sh
bash test/build_host.sh
mkdir -p test/output
python3 -c "from pathlib import Path; Path('test/output/test-psk.hex').write_text(bytes(range(32)).hex())"
test/build/receiver_sim test/output/test-psk.hex 19446 15 5 10 5
```

In another terminal:

```sh
python3 tools/pattern_sender.py --key-file test/output/test-psk.hex --seconds 5
```

The simulator prints complete LED RGB lists as JSON. Its arguments select port,
duration and three section LED counts. OFF follows within three seconds after
the pattern ends. Never reuse a test key on real hardware. LAN transmission
requires the pattern sender's explicit `--allow-lan` option; that option does
not replace hardware review or approval.
