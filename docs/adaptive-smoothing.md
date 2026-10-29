# Adaptive color transitions

The ESP selects its temporal smoothing speed from changes in the received
border palette. This runs locally in the existing 20-ms output loop; it needs
no extra TV capture, packet, video export or permanent computer process.

| Incoming change | EMA time constant |
| --- | --- |
| Normal changes, small fluctuations or localized movement | Up to 80 ms |
| Large changes across most sampled border zones | Up to 25 ms |

The existing `smoothing_ms` setting remains an upper bound. A smaller configured
value is respected, and zero disables temporal smoothing. The existing 150-ms
configuration therefore selects 80/25-ms adaptive behavior in AMBILIGHT mode.
AMBIENT retains its configured time constant. OFF still clears immediately;
the first frame after reset/OFF initializes directly as before. Brightness,
gamma, spatial interpolation, current estimation and manual-mode priority are
unchanged. No configuration/NVS schema migration or new profile ID is required.

## Palette-change heuristic

For each new session/sequence identity, compare the new RGB zones with the
previous input palette, before smoothing and gamma. Select the fast path only
when both conditions hold:

- Mean absolute RGB-channel difference across all zones is at least 48/255.
- At least 60% of zones change by at least 64/255 in one or more channels.

This compares corresponding zones rather than only a whole-palette average,
so rearranged colors can trigger fast smoothing even if the overall average
stays the same. One strongly changed zone alone does not classify a broad
change. The selected speed remains in effect for that input frame; repeated
20-ms renders do not count it as additional changes. Session or zone-layout
changes reset the comparison baseline. State stays bounded in RAM.

This is a color-palette heuristic, not semantic video-cut recognition. It can
miss scene cuts with similar border colors and classify broad flashes or camera
movement as large changes. Thresholds are initial engineering choices, with
synthetic regression coverage; perceptual tuning still needs visible LED tests.

## Response and diagnostics

Smoothing uses `alpha = 1 - exp(-elapsed_ms / time_constant_ms)` on RGB before
gamma. The time constant is not a fixed delay or a complete fade duration.
A constant step reaches about 90% of its pre-gamma RGB target after 184 ms
on the 80-ms path or 58 ms on the 25-ms path. Gamma and the initial colors
affect the final drive values. These figures are mathematical responses, not
measured physical screen-to-light latency. Smoothing cannot remove capture,
sampling or transport delay.

The authenticated ESP `/status` response adds:

| Field | Meaning |
| --- | --- |
| `color_algorithm` | `adaptive-v1` identifies the installed implementation |
| `smoothing_ms` | Currently selected time constant; zero while OFF |
| `fast_transition` | Fast class selected for the current input frame; may remain true after its fade settles |
| `scene_changes` | Large-palette-change count since boot, incremented once per classified input frame |

Read these with `python3 tools/controller.py status`. Installing a TV package
alone cannot update this ESP algorithm. Preserve the existing private profile
and settings when flashing the verified receiver image.

## Automated validation

`bash test/run_all.sh` exercises the actual C color engine under ASan/UBSan:
small-step convergence, large-cut response without an instantaneous jump,
localized movement/noise, spatial rearrangement with equal average color,
session/layout/sequence-wrap handling, render-cadence independence, immediate
OFF, AMBIENT behavior and brightness/current bounds. These checks do not
establish physical signal quality, visual comfort or real LED performance.

## Receiver deployment check

The updated S3 application was flashed with the strip disconnected, retaining
the existing bootloader, partition table, private profile and saved AUTO mode.
Both classic ESP32 and S3 builds passed, as did the complete local test suite.
In a roughly 61-second live observation the receiver accepted 190 additional
packets with no new invalid/stale packets or sender errors. Both 80-ms and
25-ms selections were observed in its status, along with one newly classified
large palette change. Full configured brightness was retained. Physical LED
output, perceived transitions and screen-to-light latency remain unverified.
