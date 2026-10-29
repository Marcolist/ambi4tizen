# Bounded capture diagnostic

This optional ES5/Node 4 service is the diagnostic baseline for Ambi4Tizen.
It calls the existing display-capture broker once per authenticated request,
computes six full-frame color means and deletes its own temporary RAM JPEG.
It exports color statistics, not images. The service is limited to 12 captures
per launch, a 1.5-second cooldown and a five-minute lifetime.

The production prototype lives in [tv/](../tv/README.md) and reuses this folder's
capture core and licensed JPEG decoder. It computes configurable U-edge zones
and sends authenticated UDP to the ESP32 without PC-triggered captures.

Prerequisites and private target setup: [installation guide](../README.md).
The diagnostic widget can be built with `python3 poc/build_widget.py` and
operated with `poc/deploy_web_probe.py` without `--sender`:

```sh
python3 poc/deploy_web_probe.py install
python3 poc/deploy_web_probe.py launch
python3 poc/deploy_web_probe.py capture --context "short approved diagnostic"
python3 poc/deploy_web_probe.py stop
```

Only use on a device you control, after reviewing the target identity. Evidence,
device addresses and access tokens belong exclusively in ignored local paths.
This is a diagnostic baseline, not evidence of continuous background operation.
No root, firmware/security changes, protected-app removal or account access is
implemented. The JPEG decoder's original notices and license texts are retained.
