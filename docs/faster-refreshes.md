# Refresh optimization branch and live acceptance

Work is isolated on `codex/faster-refreshes`. **Do not merge into `main` until
the live acceptance checks below pass.** Local test/build success is not a TV
performance result. The installed working sender and receiver remain the
baseline until deliberate deployment.

## Implemented paths

| Option | Implementation | What must be measured on the TV |
| --- | --- | --- |
| Lower JPEG quality | Validated `jpeg_quality` 20–90; default 55, comparison 35 | Actual JPEG bytes, broker/decode times and edge-color plausibility |
| Smaller capture request | Existing 480x270/320x180/160x90 options; separate source and decoded dimensions in status | Whether the broker honors the request; a previous 320x180 request still returned 480x270 |
| Native scaled decode | Persistent stdin/stdout ARMv7/NEON helper, pinned libjpeg-turbo 3.2.1, scale 1/2/4/8 | Execution inside the normal app sandbox, actual dimensions, decode time, worker RSS and letterbox detection |
| Persistent D-Bus | Pinned Node-4-compatible client; one fixed EXTERNAL-authenticated system-bus connection | Sandbox access and capture results; connection/process savings |
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

Follow the [optional build instructions](../tv/README.md#optional-faster-paths-live-validation-pending).
All SDKs, dependency downloads, private settings and generated packages stay
outside tracked source. The baseline defaults remain JS decoding and the
`dbus-send` process backend with no pipeline.

Recommended experimental configuration after preflight:

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
  --rollback-package .local/known-working-sender.wgt --seconds 30
```

The named WGT must be the working sender signed for this TV and use the same
existing private credentials. The tool does not infer which package is
installed. It prepares all selected packages first, uses the identity-pinned
deployment wrapper, captures aggregate timings/counters and attempts to
restore/relaunch that working package on completion, failure or Ctrl-C. It also
restores the original local configuration and build output. A powered-off or
disconnected TV can prevent remote recovery; that failure is recorded explicitly.
Do not use an untested package as the rollback reference.

Profiles are `baseline`, `quality`, `size`, `native`, `bus`, `pipeline`, `auto`.
Use repeated `--profile` arguments to select a shorter subset. Each step changes
one capture optimization relative to the previous step; `auto` adds fallback
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
No merge or production promotion is automated.
