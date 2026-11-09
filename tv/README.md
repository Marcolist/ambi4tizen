# Samsung sender for Tizen 4 / Node.js 4.4.3

The existing service's proven capture call remains the foundation. The new
`ambiSend40` app is a separately built UDP sender with a configurable time limit, disabled by default.
Visible multicolor output has been demonstrated with the baseline sender. The
selected DC preview has now passed a bounded TV live test; the native and
persistent-bus alternatives remain unvalidated/unavailable on this setup. Setup:
[main README](../README.md). The diagnostic package remains separate.

The shared capture core is `poc/web-probe/capture-core.js`. During packaging,
its actual implementation replaces the repository import shim in `tv/`.
The legacy diagnostic retains its six full-frame grid zones and maximum of
12 captures per launch.

Capture uses normal mode 0 / application type 0 / composition 1. JPEG quality
defaults to 55 and can be set to 20–90.
There is no mode probing, root access, system-file modification or image export.
A RAM JPEG is read, decoded, summarized and deleted under its own bounded
filename. Unexpected returned paths are neither opened nor deleted. Cleanup
failure stops the sender. Unexpected process termination or a broker writing
late after timeout could leave RAM files; cleanup across every TV lifecycle
event has not been demonstrated.

## Catalog distribution

`catalog/` supplies a separate generic Start/Stop launcher and service with two
installer placeholders. Build it with `python3 tools/build_catalog.py` from the
repository root. It excludes the private diagnostic server and requires explicit
manual Start after receiver validation. See [Apps2Samsung packaging and the
live gate](../docs/apps2samsung.md). The private developer build below is not a
public release artifact.

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
| interval_ms | 1000 by default; experimental minimum 100; target cadence, not a frame-rate guarantee |
| duration_ms | 30000 by default; 0 explicitly selects continuous operation; otherwise 1000–3600000 |
| jpeg_quality | 55 by default; integer 20–90; compare 35 for lower JPEG cost |
| decoder | `js` (default), `js-dc` (coarse block means), `native` (strict), or `auto` (native with JS fallback) |
| decode_scale | Native decode denominator 1, 2, 4 or 8; default 1; reduced if either side would become smaller than 24 pixels |
| broker | `process` (default), `persistent` (strict), or `auto` (persistent with process fallback) |
| pipeline | `false` by default; one-frame lookahead during decoding, with bounded buffers |

```sh
python3 tools/build_sender.py
```

The build uses locally configured Samsung/Tizen SDK signing tools and a local
.NET SDK **on the development computer only**. The TV package contains HTML,
ES5/Node code and the existing licensed JPEG decoder. Optional local builds
add the ARM worker. The fixed ES5 D-Bus client has no npm runtime dependencies. Output:
`poc/build/ambilight-sender.wgt`. Without private configuration, the package is
signed but its service performs no work on startup. Private keys are written
only into the ignored local package. Building does not install or contact the TV.

Launching or reopening the UI starts the service and hides the UI. This does not
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

Only one broker capture can run at a time. By default the next frame starts
after the configured interval or completion, whichever is later. With the
optional pipeline, the next broker capture may overlap asynchronous native
decoding. There is at most one queued JPEG, one decoder request and one broker
request. A slow target cadence suppresses early lookahead to avoid aging frames.
Stop drains an in-flight capture and deletes its RAM file; installation waits
for the old listener to close. Additional zones do not require more captures.
UDP output occurs after successful cleanup and contains at most 120 bytes.
Captures older than 1500 ms are not sent. Three consecutive processing/send
errors stop the run. Default: roughly one capture per second for 30 seconds.
This is a configured target, not a measured sustained TV rate.
At an experimental 250-ms interval a capture taking longer than the interval
reduces the delivered rate; captures still never overlap or build a backlog.
Monitor sender/receiver counters and visible playback while testing higher rates.

A short live 100-ms comparison on November 8 produced about 4.47 sends/s,
with capture-to-send median/p95 of 232/468 ms. The new letterbox sender's
preceding 250-ms window delivered about 3.83 sends/s and 187/407 ms. Content/load
were not held constant, so these sequential observations do not establish a
causal reduction in acquisition time. The 100-ms window showed no new sender
errors or receiver freshness rejections; counter snapshots are not exact
per-frame acknowledgments. Physical screen-to-LED delay remains unmeasured.

A lower target removes cadence waiting when capture takes longer than the target;
it cannot shorten the broker/JPEG operation itself or guarantee 10 frames/s.
Increased capture duty can affect playback: compare real stage timings,
receiver counters and playback before retaining a lower interval.

## Letterbox content sampling

The sender detects paired near-black horizontal bars and samples the top edge
inside the visible picture. Side zones span the visible picture height, so
wide-screen movies do not force the top LEDs off just because the screen has
black bars. Dark picture content can still correctly produce dark LEDs.

Two matching frames confirm a crop. It persists through black fades and subtitle
overlays; three frames with broadly lit outer top/bottom edges restore full-frame
sampling. Only nearly symmetric horizontal bars up to about 24% per side are
handled. Asymmetric, colored, very large or vertical bars are not detected.
This is a conservative pixel heuristic, not a content/aspect-ratio API. Local
synthetic/JPEG tests pass under Node 4.4.3. The updated package is installed on
the test TV; the operator confirmed that the top strip follows picture colors in a
letterboxed scene with the accepted DC preview.

HTTP 18793 accepts only the private developer IP and bearer token.
`GET /status` returns aggregate timings for broker, file read, JPEG decode,
zone processing, optional hashing and cleanup, plus initial/peak/latest RSS
and heap. `continuous`, `running` and `stop_reason` describe sender state.
`last_sent` contains only the most recently sent packet's averaged RGB zones,
section counts, sequence, encoding-time age and current `capture_age_ms`.
Its `width` and `height` report decoded dimensions; `source_width` and
`source_height` report the original broker/JPEG dimensions. Verify both: the
tested device previously returned 480x270 for a 320x180 request. Smaller JPEG
requests and reduced native decoding are separate optimizations. `jpeg_bytes`,
`quality`, `decoder_backend`, `broker_backend` and `native_decode_ms` identify
the actual path. `capture_engine` includes fallback/queue counters and native
worker RSS where available, separate from the Node process RSS.
`sample_rect` reports the active picture rectangle, `letterbox` indicates a
confirmed crop, and `profile_ms` contains timings for this particular frame.
It is null before the first successful send and is replaced rather than queued.
Use its current age before interpreting colors as live. A successful UDP send
does not prove reception or physical LED output. No JPEG or image pixels are
exposed by this endpoint; access retains the same developer-IP/token checks.
`POST /stop` waits for capture completion and cleanup. In a bounded run, five
seconds remain after the test window before process exit. In continuous mode
there is no expiry timer; error stops still apply and diagnostics remain
available until explicit stop or service termination.
No arbitrary file or program commands are exposed. The sender/ESP operating
chain does not need a permanent PC service.

First test 480x270 / 12 zones / 1 Hz / 30 seconds after approval. Compare smaller
resolutions and different zone counts one at a time afterward. Inspect broker
and decode costs, maximum frame age, playback, packet loss and memory without
disrupting normal TV operation. Local fixtures cannot rule out TV memory leaks
or application-switching problems. Review live counters and playback before
extending tests or increasing the rate. Continuous mode is not a reliability guarantee.

Investigate boot startup only after a visible end-to-end success. Currently the
app must be started deliberately. Reliable background startup when the TV turns
on remains unresolved; manifest options alone do not prove it works.

## Optional faster paths

See [refresh optimization and live gate](../docs/faster-refreshes.md) for the
implementation, limitations, comparison commands and rollback procedure.

Prerequisites: Python 3.12+, CMake, a host C compiler and, for the TV binary,
`arm-linux-gnueabihf-gcc` with its cross libc development files. Preparation
runs only on the development computer; it does not contact or modify the TV.

```sh
python3 tools/build_native.py --target host
python3 tools/build_native.py --target armv7
python3 tools/build_sender.py
```

The worker statically links pinned libjpeg-turbo 3.2.1 and requires ARMv7/NEON.
For the optional local private-bus test fixture only, run
`python3 tools/prepare_tv_deps.py` (requires npm).
The package builder verifies ARM architecture, binary hash and worker source
hash. Source downloads, dependencies, licenses and binaries remain in `.local`.
The package includes upstream licenses. This software is based in part on the
work of the Independent JPEG Group.

Authenticated `GET /capabilities` performs a fixed worker self-test and capture
broker introspection. It exposes no arbitrary path or command execution.
Native execution and direct system-bus access must pass in the actual Tizen
application sandbox. A host test or QEMU execution cannot establish that.
`auto` falls back if the worker is absent, rejected or fails. A persistent bus
failure may retry the current frame through `dbus-send` only if the capture was
never submitted. A submitted/timed-out capture is not duplicated; the next
frame can use the process fallback. Strict backends report an error instead.

Raw RGB capture is not implemented: the inspected normal broker's proven
synchronous file method returns JPEG. Other asynchronous/XWD methods do not
provide a verified usable raw buffer in this application context. `comp_type`
is composition selection, not a JPEG/raw format switch; it remains 1.

### First TV preflight on the optimization branch

The worker self-test is currently blocked with `spawn EACCES` in the installed
web package, and its mode cannot be changed (`chmod EACCES`). This is not a
successful native-decode deployment. The tested app namespace exposes none of
`/run/dbus/system_bus_socket`, `/var/run/dbus/system_bus_socket` or
`/opt/var/run/dbus/system_bus_socket`. The advertised session address uses a
kernel kdbus endpoint with a Unix fallback; that does not establish an available
system-bus Unix transport. The fixed client reports `ENOENT` and `auto` uses
`dbus-send` instead. No kernel transport, security-policy change or native
execution workaround is implemented.

An attempted separate Node probe was also rejected by the TV's signature
checks. Production preflight now uses the fixed ES5 client directly with bounded
parsing and error handling; it launches no separate Node script. The initial
third-party D-Bus preflight terminated the sender process on this TV; its cause
was not established. That dependency is no longer loaded or packaged by the
production sender. It remains only a synthetic service fixture in local tests.

The final fixed preflight also tests a bounded temporary copy of the worker in
this app's own data directory after resource execution fails. The copy uses
exclusive creation, is removed after the test and exposes no arbitrary paths.
On this TV execution there returned `EPERM` as well, with cleanup confirmed.
The measured candidate uses quality 55 and the existing JS/process backends
with pipeline enabled: about 6.67 versus 4.56 sends/s in sequential 30-second
windows. Median capture-to-send age rose from 208 to 233 ms; physical delay
improvement has not been demonstrated. See the full comparison and limitations
in the [refresh report](../docs/faster-refreshes.md#measured-tv-comparison-november-8-2026).

## Optional JavaScript DC preview

DC mode needs no native build or npm dependency: select `decoder=js-dc` in the
existing private configuration, then use the normal sender build/install.
It retains JPEG entropy/progressive parsing and limits but replaces
full pixel reconstruction with the dequantized DC mean of each 8x8 component
block. It produces a coarse RGB preview (60x34 for a 480x270 JPEG) before zone
sampling, avoiding full IDCT and most color-conversion work. It is approximate
for LED colors: fine detail is intentionally dropped, chroma is coarser with
subsampled JPEGs, and saturated/clipped edges can differ from full decoding.
It is not an image-export feature or a native helper workaround.

Both source dimensions must be at least 192 pixels; smaller images and CMYK
retain full decoding so zone dimensions stay valid. Status distinguishes
`js-dc` from full `js`, and preserves original `source_width`/`source_height`.
The ordinary `js` default is unchanged. Tests cover baseline/progressive JPEG,
grayscale, chroma subsampling, odd/minimum dimensions, edge-color averages,
small-image fallback and letterbox sampling under Node 4.4.3. The modified
upstream decoder and its attribution remain under the included Apache terms.

After the pipeline-only candidate still had objectionable visible delay, the
next installed candidate selects `decoder=js-dc`, `jpeg_quality=55`,
`broker=process`, `pipeline=false`, `resolution=480x270`, `interval_ms=100` and
`duration_ms=0`. It delivered about 5.9 sends/s and 166-ms sampled median age in
one short comparison. The operator subsequently confirmed noticeably faster response, plausible
colors and correct top-strip behavior with black bars. A further 60-second
window had no new sender/receiver errors. This is bounded acceptance, not a
physical latency guarantee or long-term reliability result.
