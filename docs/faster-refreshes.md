# Refresh optimization branch and live acceptance

Development and TV comparisons took place on `codex/faster-refreshes`. The
selected **DC / quality 55 / no-pipeline** profile passed the bounded live
acceptance check on November 8, 2026. Native decoding, persistent system-bus
access, raw capture and the new ESP smoothing API are not included in that
success. Local build success alone remains insufficient for other setups.

## Implemented paths

| Option | Implementation | What must be measured on the TV |
| --- | --- | --- |
| Lower JPEG quality | Validated `jpeg_quality` 20–90; default 55, comparison 35 | Actual JPEG bytes, broker/decode times and edge-color plausibility |
| Smaller capture request | Existing 480x270/320x180/160x90 options; separate source and decoded dimensions in status | Whether the broker honors the request; a previous 320x180 request still returned 480x270 |
| Native scaled decode | Persistent stdin/stdout ARMv7/NEON helper, pinned libjpeg-turbo 3.2.1, scale 1/2/4/8 | Execution inside the normal app sandbox, actual dimensions, decode time, worker RSS and letterbox detection |
| Persistent D-Bus | Dependency-free ES5 client; one fixed EXTERNAL-authenticated Unix connection | Sandbox access and capture results; connection/process savings |
| Bounded pipeline | One broker request overlaps asynchronous decode; one queued JPEG at most | Sustained sends/s, capture age, memory, playback and shutdown cleanup |
| Shorter smoothing | Receiver command `smoothing_ms` 0–3000; candidate cap 40 ms with adaptive cuts | Visible transitions and response; this does not increase capture rate |
| Raw image access | No verified normal-app raw buffer route; JPEG remains the supported path | Further investigation required before a raw implementation is possible |

The inspected `samsung.tizen.dcapture` interface exposes
`RequestCaptureToFileSync` with six integer inputs and two strings; the proven
call uses application type 0, capture mode 0 and composition 1. Its reply is
status, width, height and a RAM JPEG path. Other capture methods are asynchronous
or require app/display/window context and do not expose a verified raw RGB
buffer for this service. Composition selection is not a compression selector.
This branch does not change capture mode, access hardware registers or modify
TV firmware/security policy to pursue raw capture.

## Preparation and fallbacks

Follow the [optional build instructions](../tv/README.md#optional-faster-paths).
All SDKs, dependency downloads, private settings and generated packages stay
outside tracked source. The baseline defaults remain JS decoding and the
`dbus-send` process backend with no pipeline.

Portable experimental configuration after preflight (not the selected profile
for the tested TV):

```json
{
  "resolution": "160x90",
  "interval_ms": 100,
  "jpeg_quality": 35,
  "decoder": "auto",
  "decode_scale": 4,
  "broker": "auto",
  "pipeline": true
}
```

Apply these fields only inside the existing private `sender` object; preserve
credentials, addresses and other settings. Rebuild/reinstall after changes.
`auto` reports which backend actually ran and counts fallbacks. It is not proof
that native decoding or persistent D-Bus succeeded. Strict `native` and
`persistent` settings are useful for isolated measurements because failures
cannot silently turn into baseline measurements.

The native worker accepts only bounded JPEG bytes over pipes. It cannot open
capture files or devices. It uses a framed RGB reply, a two-second client
timeout, dimension checks and one pending decode. The parent deletes its own
RAM JPEG before decoding. A capture already submitted to the broker is never
retried on timeout; only a failure before submission permits a same-frame
process fallback. At stop, an in-flight capture finishes cleanup before the
deployment wrapper replaces the app. Loss of power or a broker writing late
after timeout remains a lifecycle limitation.

## Reproducible comparisons and recovery

Keep a signed copy of the known working sender in ignored local storage before
changing it. The following command only builds private packages; it does not
contact the TV or leave the local configuration changed:

```sh
python3 tools/benchmark_refresh.py
```

For a commissioned receiver, running comparisons is an explicit TV action:

```sh
python3 tools/benchmark_refresh.py --run \
  --rollback-package .local/known-working-sender.wgt \
  --profile baseline --profile pipeline-js --seconds 30
```

The named WGT must be the working sender signed for this TV and use the same
existing private credentials. The tool does not infer which package is
installed. It prepares all selected packages first, uses the identity-pinned
deployment wrapper, captures aggregate timings/counters and attempts to
restore/relaunch that working package on completion, failure or Ctrl-C. It also
restores the original local configuration and build output. A powered-off or
disconnected TV can prevent remote recovery; that failure is recorded explicitly.
Do not use an untested package as the rollback reference.

Profiles are `baseline`, `quality`, `size`, `pipeline-js`, `dc`, `dc35`, `dc-pipeline`, `native`, `bus`,
`pipeline`, `auto`. `pipeline-js` isolates lookahead with quality 55 and the
original 480x270/JS/process path.
Use repeated `--profile` arguments to select a shorter subset. The quality/size/native/bus/pipeline sequence changes
one capture optimization per step; `auto` adds fallback
behavior. Capture targets are 100 ms and runs are bounded to the chosen window
plus a small diagnostic margin. No profile changes brightness or receiver
settings. A processing error or stopped sender aborts and triggers recovery.

Results, signed packages and logs go into `.local/refresh-benchmarks/`. Reports
include actual source/decoded sizes, backend names, mean stage times, send rate,
memory and before/after receiver counters. Age percentiles use unique frames
observed by polling and are **sampled**, not every frame. Send rate uses counter
deltas; UDP sends do not establish physical LED latency or delivery. Keep the
same clip, playback position and network conditions for meaningful comparisons.

## Acceptance before merge

- Worker self-test and direct-bus introspection succeed on the TV, or the
  retained configuration explicitly documents a measured fallback decision.
- Compare at least baseline and selected optimized profile on the same content.
  Require a measurable refresh/age benefit without new sender errors, receiver
  invalid/stale rejections or unexplained memory growth during the test window.
- Observe internal-app playback, menus and app switching. Streaming must remain
  usable without new stalls attributable to capture load.
- Confirm physical side/top mapping and plausible colors, including a brightly
  colored scene and a letterboxed scene with the top strip following content.
- Confirm reduced perceived delay and acceptable small transitions/cuts. Measure
  screen-to-light delay separately if a numerical physical-latency claim is made.
- Stop/relaunch and verify cleanup/recovery. A short run does not establish
  long-term reliability or reliable startup after TV power-on.
- If using the new smoothing command, flash only the physically verified
  Ambilight receiver with all non-USB wiring disconnected, then verify its
  reported cap and visible behavior after reconnection.

The benchmark always records `live_test_passed=false`. Only the operator's
visible confirmation plus the recorded device evidence can close this gate.
The benchmark tool itself never merges or promotes code.

## Initial device preflight result

The ARM helper is blocked by `spawn EACCES` in the installed web package; chmod
is also denied. None of the three standard system-bus Unix socket paths exists
in the application namespace. The session bus advertises kdbus, but a usable
system-bus Unix connection has not been demonstrated. The custom ES5 client
fails cleanly with `ENOENT`; the retained `auto` path uses JS decoding and
`dbus-send`. Native execution and persistent capture are therefore **not live
validated** on this device. Local host/QEMU/private-bus successes do not override
these negative TV results. Further native packaging or kernel-bus work is
outside this implementation; no TV policy/firmware changes were made.

## Measured TV comparison (November 8, 2026)

All windows below were 30 seconds at a 100-ms target on the tested Tizen 4 TV,
with normal streaming playback. Content continued between windows; these are
sequential observations, not a synchronized identical-frame benchmark. Ages
are sampled capture-start-to-send values, not physical screen-to-LED latency.

| Profile | Sends/s | Sampled age median / p95 (ms) | New sender / receiver errors |
| --- | ---: | ---: | --- |
| Baseline, quality 55 | 4.60 | 211 / 328 | 0 / 0 |
| Quality 35 | 4.64 | 201 / 343 | 0 / 0 |
| 160x90 request, quality 35 | 4.69 | 205 / 333 | 0 / 0 |
| Auto backends + pipeline, quality 35 | 6.24 | 237 / 385 | 0 / 0 |
| Second baseline, quality 55 | 4.56 | 208 / 362 | 0 / 0 |
| JS/process pipeline, quality 55 | 6.67 | 233 / 303 | 0 / 0 |

The 160x90 request still returned 480x270. Auto actually used JS/process, with
native execution and persistent-bus fallbacks visible in its counters; it is
not a native-decoder result. Quality reduction alone produced no clear useful
refresh improvement in these observations. The second pipeline comparison
kept quality and resolution unchanged and observed about 46% more sends/s.
The median age increased by about 25 ms, while p95 decreased in that window:
more frequent updates do **not** establish a shorter physical delay.

The first live candidate therefore explicitly used `decoder=js`,
`broker=process`, `jpeg_quality=55`, `resolution=480x270`, `pipeline=true`,
`interval_ms=100` and continuous operation. It avoids retrying unavailable
backends and retains the original image quality. No new ESP image is needed
for this TV-side candidate. The separate receiver smoothing API is built but
has not been flashed or physically validated.

Pipeline RSS reached about 92 MiB in the second short comparison versus about
69 MiB for its baseline. A longer observed window and visible playback checks
remain necessary; a peak alone cannot distinguish allocator retention from a
leak. No long-term memory or latency guarantee follows from these short tests.

A final native preflight copied the helper exclusively into the application's
own writable data directory with executable mode. Execution was still denied
with `EPERM`, and the temporary helper was deleted. Read-only package mode is
therefore not the only obstacle. No signing/security check was disabled.

### Further latency experiment: JavaScript DC preview

After the operator confirmed plausible colors but still objectionable delay,
an opt-in `js-dc` decoder was added to reconstruct only JPEG block means for LED
sampling. It does not require native execution or a persistent bus. Profiles
`dc` and `dc-pipeline` isolate this decoder with quality 55, respectively without
and with lookahead. This changes spatial approximation and therefore requires
new color/letterbox and visible-delay checks; higher packet rate alone cannot
close the latency gate. See [DC implementation and limits](../tv/README.md#optional-javascript-dc-preview).

The JS pipeline then completed a 120.7-second observation at 5.81 sends/s with
700 newly accepted packets and no new invalid/unauthorized/stale/socket or
sender errors. RSS fluctuated with collection instead of growing monotonically
in the sampled window. The operator confirmed plausible colors but reported
that the delay still disturbed them: **the latency acceptance gate did not
pass**. This observation does not authorize merging into `main`.

The first DC comparison (again sequential 30-second windows) gave:

| Decoder / lookahead | Sends/s | Sampled age median / p95 (ms) | Mean decode (ms) | Peak Node RSS (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Full JS + pipeline | 6.36 | 240 / 362 | 76.5 | 88.9 |
| DC, no pipeline | 5.82 | 169 / 237 | 35.7 | 48.7 |
| DC + pipeline | 6.78 | 203 / 247 | 37.7 | 54.7 |

All had no new sender/receiver errors. The DC-only result reduced measured age
and memory; adding lookahead increased rate and median age in this comparison.
The DC candidate needs fresh visible color, black-bar and delay acceptance.
A subsequent `dc35` profile tests quality 35 with the same DC-only path; JPEG
quality changes may affect both entropy cost and coarse color approximation.

A second DC-only comparison retained the same settings except JPEG quality:
quality 55 delivered 5.89 sends/s, 166/213 ms sampled median/p95 age and 35.4 ms
mean decode; quality 35 delivered 5.78 sends/s, 166/236 ms and 35.9 ms decode.
Neither had new sender/receiver errors. Quality 35 showed no additional useful
benefit in these windows, so the next continuously installed candidate uses
**DC / quality 55 / no pipeline**, with a 100-ms target and no duration limit.
This preserves JPEG quality while favoring the lower observed frame age.
Operator acceptance of this approximation and visible delay subsequently passed
for this bounded test, as recorded below.

## Accepted live configuration

The operator confirmed that the selected DC mode was noticeably faster, that
colors matched, and that the upper LEDs followed picture colors with black
bars present. Streaming playback had also been reported as fluent during the
checks. A further 60.0-second continuous window delivered 5.81 sends/s with 346
newly accepted receiver packets and zero new sender errors, invalid packets,
unauthorized packets, stale rejections or socket errors. Counter snapshots are
not exact per-packet acknowledgments.

The TV remains in continuous `js-dc` / process / quality 55 / 480x270 request /
100-ms target / no-pipeline mode. Source is still 480x270; the reconstructed
preview is 60x34. The ESP keeps its existing firmware and smoothing settings;
no USB device or server display was flashed in this work.

This closes the short live gate for that configuration. Physical latency in
milliseconds, calibrated color fidelity, multi-hour stability, other content/
apps/models and TV boot startup remain unverified. The normal disabled/default
configuration is unchanged. Experimental native/persistent/pipeline alternatives
remain explicit options, not claims of equivalent validation.
