# Samsung sender for Tizen 4 / Node.js 4.4.3

The existing service's proven capture call remains the foundation. The new
`ambiSend40` app is a separately built, bounded UDP sender, disabled by default.
A live test of the new sender including LED output is still pending. Setup:
[main README](../README.md). The diagnostic package remains separate.

The shared capture core is `poc/web-probe/capture-core.js`. During packaging,
its actual implementation replaces the repository import shim in `tv/`.
The legacy diagnostic retains its six full-frame grid zones and maximum of
12 captures per launch.

Capture uses normal mode 0 / application type 0 / composition 1, quality 55.
There is no mode probing, root access, system-file modification or image export.
A RAM JPEG is read, decoded, summarized and deleted under its own bounded
filename. Unexpected returned paths are neither opened nor deleted. Cleanup
failure stops the sender. Unexpected process termination or a broker writing
late after timeout could leave RAM files; cleanup across every TV lifecycle
event has not been demonstrated.

## Configuration and local build

Create the private file/header as described in the
[firmware guide](../firmware/README.md). Initially keep `sender.enabled=false`.

| Setting | Default / meaning |
| --- | --- |
| esp_ip | Explicit unicast IPv4 of the ESP; no discovery/broadcast |
| developer_ip | Only this IPv4 may request bounded TV diagnostics |
| port | 19446; must match the ESP |
| zones | 6, 12, 18 or 24; default 12 |
| edge_depth | 0.02–0.25; default 0.1 |
| resolution | 480x270, alternatively 320x180 or 160x90 |
| interval_ms | 1000; minimum supported value 500 |
| duration_ms | 30000; longer live runs require separate approval |

```sh
python3 tools/build_sender.py
```

The build uses locally configured Samsung/Tizen SDK signing tools and a local
.NET SDK **on the development computer only**. The TV package contains HTML,
ES5/Node code and the existing licensed JPEG decoder. Output:
`poc/build/ambilight-sender.wgt`. Without private configuration, the package is
signed but its service performs no work on startup. Private keys are written
only into the ignored local package. Building does not install or contact the TV.

Launching the UI later starts the service and hides the UI. This does not
establish boot startup. Continued operation alongside Netflix, Prime Video
and Disney+ requires new practical tests after installation.

For a separately approved test, the existing identity-pinned SDB wrapper can
operate the new sender:

```sh
python3 poc/deploy_web_probe.py install --sender
python3 poc/deploy_web_probe.py launch --sender --context "Approved 30-second test"
python3 poc/deploy_web_probe.py status --sender
python3 poc/deploy_web_probe.py stop --sender
```

The wrapper checks the saved device name, model and MAC plus the matching TV
source IP. A disabled sender configuration cannot be launched. Without
`--sender`, the wrapper operates the legacy diagnostic package.

## Load and profiling

Only one capture can run at a time. The next starts after the configured
interval or after the previous capture finishes, whichever is later. No capture
backlog is queued, and additional zones do not require additional captures.
UDP output occurs after successful cleanup and contains at most 120 bytes.
Captures older than 1500 ms are not sent. Three consecutive processing/send
errors stop the run. Default: roughly one capture per second for 30 seconds.
This is a configured target, not a measured sustained TV rate.

HTTP 18793 accepts only the private developer IP and bearer token.
`GET /status` returns aggregate timings for broker, file read, JPEG decode,
zone processing, optional hashing and cleanup, plus initial/peak/latest RSS
and heap. `POST /stop` waits for capture completion and cleanup. Five seconds
remain after the test window to read diagnostics before the process exits.
No arbitrary file or program commands are exposed. The sender/ESP operating
chain does not need a permanent PC service.

First test 480x270 / 12 zones / 1 Hz / 30 seconds after approval. Compare smaller
resolutions and different zone counts one at a time afterward. Inspect broker
and decode costs, maximum frame age, playback, packet loss and memory without
disrupting normal TV operation. Local fixtures cannot rule out TV memory leaks
or application-switching problems. Longer runs and higher rates need further review.

Investigate boot startup only after a visible end-to-end success. Currently the
app must be started deliberately. Reliable background startup when the TV turns
on remains unresolved; manifest options alone do not prove it works.
