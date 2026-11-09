# Apps2Samsung catalog package

Status: local checks passed; actual Apps2Samsung installation and manual-start
verification on the UE65NU7179 are pending. Do not publish the release asset or
submit the catalog PR until that live gate passes.

The integration follows [Patrick's packaging guidance](https://github.com/Apps2Samsung/tizen-community-packages/discussions/234#discussioncomment-19477935)
and the upstream [user-settings contract](https://github.com/Apps2Samsung/tizen-community-packages/blob/main/packages/README.md).
There is no TV setup menu. A small launcher offers Start and Stop.

## Build the public template

From the repository root, with Python 3:

```sh
python3 tools/build_catalog.py
```

Output: `poc/build/ambi4tizen-catalog.wgt` (version 0.4.0, Tizen 4.0 minimum).
This is a reproducible **unsigned template** for Apps2Samsung to patch and sign,
not a directly installable signed development package. The builder never reads
the private configuration. It packages a fixed list of source files, the JPEG
decoder and the required licenses; no certificates, native worker, logs or
private configuration are included.

The `service.js` replacement contract has exactly one occurrence of each:

```js
"esp_ip": ""
"key_hex": ""
```

The proposed catalog manifest is
[`distribution/apps2samsung/Marcolist__ambi4tizen.json`](../distribution/apps2samsung/Marcolist__ambi4tizen.json).
Its stable field keys are `esp_ip` and `key_hex`; replacements are independent
and run before signing. Empty, malformed or all-zero keys and invalid unicast
IPv4 addresses are rejected. Receiver setup and the correct key location are
explained in [the README](../README.md#apps2samsung-receiver-settings).

Do not confuse this with `poc/build/ambilight-sender.wgt`, built by
`tools/build_sender.py`: that package can contain real addresses, the UDP key
and diagnostic credentials. **Never upload the private sender package.**
An installed/patched copy from Apps2Samsung also contains the user's UDP key;
only the untouched generic template is suitable for a public release.

## Activation and stopping

`onStart` does not construct a sender, open UDP or request capture. Only a
Start application-control request from this package's own foreground launcher,
with both receiver fields validated, creates and starts the sender. There is
no permanently false `capture_enabled` gate. The service has no automatic
restart and no boot hook. Package IDs are resolved at runtime so installer
renaming preserves the launcher-to-service link.

Start is idempotent while running. Stop cancels further capture, drains an
in-flight capture and closes its resources. After a sender error stops capture,
an observer closes the sender; the user can start again. No HTTP server or
diagnostic token is part of the catalog service. Receiver-side diagnostics
remain available on the ESP32 as before.

The fixed capture profile is `js-dc`, process broker, 480x270, JPEG quality 55,
100-ms scheduling target, no pipeline, 12 zones and continuous operation after
manual Start. UDP port 19446 must match the receiver. This does not guarantee
10 updates/s: the previously accepted private sender measured about 5.8–5.9/s
on the test TV. This catalog package still needs its own live verification.

## Local checks and pre-release installer test

```sh
bash test/run_all.sh
python3 tools/catalog_test_feed.py
```

The second command serves only the freshly built **generic** WGT and three
catalog metadata documents on `127.0.0.1:18794`. It never serves a directory or
reads private receiver settings. Stop it with Ctrl+C. This is a local fixture,
not an approved/public Apps2Samsung source.

With an Apps2Samsung CLI supporting one-off `--source` feeds (tested with
3.2.0-beta), another terminal can inspect both installer fields:

```sh
apps2samsung-cli catalog Ambi4Tizen \
  --source http://127.0.0.1:18794/feed.json \
  --data-dir .local/apps2samsung/test-data --json
```

The CLI lists both required settings, Tizen 4.0 minimum and the generic WGT.
This lookup passed locally; it does not establish TV installation, successful
patching/signing or capture permissions. The desktop installer can remember and
prefill settings; the CLI requires `--set esp_ip=... --set key_hex=...` on each
install. Keep real CLI values and its data/cache/log directories private. Do
not put a real key in published commands or shell history.

Tests execute the production catalog service and launcher under current Node
and, when installed, Node 4.4.3. They cover invalid and partial settings, no
capture on service/launcher startup, caller isolation, explicit Start/Stop,
duplicate Start, capture-error cleanup, draining and package-ID renaming.
Package tests check reproducibility, the allowlist, manifest metadata and absence
of private configuration values. Upstream schema validation is additionally run
when `.local/apps2samsung/packages.schema.json` and Python `jsonschema` exist.
These checks simulate Tizen application control; its actual service lifecycle
and reply behavior remain part of the live gate.

## TV acceptance and release gate

1. Keep a private backup of the working signed sender and its existing settings.
   Verify the pinned TV identity, Developer Mode and receiver identity. Do not
   change firmware or any other installed TV app.
2. Stop and drain the old sender. Use the local feed to install with
   **Apps2Samsung itself**, supplying the existing ESP IPv4 address and UDP key.
   This must exercise both `user_settings` replacements and installer signing,
   rather than installing a manually patched package.
3. Install without automatic launch. Verify the receiver's accepted-frame counter
   stops increasing after old traffic drains. Open the launcher and verify it
   remains idle until the user presses Start. Verify the old TV diagnostics port
   is closed. Keep the signed/patched package and installer logs private.
4. Press Start on the TV. Confirm new authenticated packets at the ESP, matching
   LED colors, stable playback in an internal streaming app and top-edge colors
   with black bars. Reopen, press Stop, verify traffic stops, then start again.
   Check installer package-ID renaming if it is needed for certificate/ID conflicts.
5. Exercise an update with the same field keys and check receiver settings are
   preserved/prefilled. Restore the working private sender if activation fails;
   record the failure without claiming catalog readiness.
6. Only after passing: publish the source version and attach the **generic**
   `ambi4tizen-catalog.wgt` to the matching GitHub Release. Copy the prepared
   manifest to `packages/Marcolist__ambi4tizen.json` in a catalog PR, with the
   real test results and a release link. Update the pending status in the README.

No public release or catalog PR has been created for this untested build.
