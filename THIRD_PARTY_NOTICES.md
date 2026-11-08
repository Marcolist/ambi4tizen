# Third-party notices

## jpeg-js decoder

`poc/web-probe/vendor/jpeg-decoder.js` is derived from jpeg-js 0.4.4.
Its upstream source, pinned commit and ES5 compatibility changes are documented
in [NOTICE.txt](poc/web-probe/vendor/NOTICE.txt).

The upstream decoder carries an Apache-2.0 notice; the jpeg-js package carries
a BSD-3-Clause license. Both complete texts are included:

- [Decoder Apache-2.0 license](poc/web-probe/vendor/LICENSE.Apache-2.0)
- [jpeg-js BSD-3-Clause license](poc/web-probe/vendor/LICENSE.jpeg-js)

Original copyright and attribution remain unchanged. The opt-in DC block-mean
preview is a documented local algorithm modification under the decoder's
Apache-2.0 terms; its default full decode remains unchanged. No TV image fixtures or
streaming content are included; tests generate their own synthetic images.

## External build dependencies

ESP-IDF, Espressif led_strip, Tizen SDK tools, signing certificates, Node.js,
OpenSSL and Python dependencies are not vendored in this source repository.
They retain their respective licenses. ESP-IDF/led_strip dependencies are
pinned in the firmware manifest/lock file. Generated packages and firmware
images are excluded from this repository.

The classic ESP32 Arduino receiver pins the PlatformIO espressif32 platform
to 6.9.0 and Adafruit NeoPixel to 1.12.3 in `firmware/arduino/platformio.ini`.
These dependencies are downloaded by PlatformIO and retain their upstream
licenses; no library source or private binary is published here. The tested
platform, pixel format and initialization sequence follow the owner's
[EspMoveLamp project](https://github.com/Marcolist/EspMoveLamp).

## Optional native JPEG worker

`tools/build_native.py` downloads unmodified libjpeg-turbo 3.2.1 from its
[official release](https://github.com/libjpeg-turbo/libjpeg-turbo/releases/tag/3.2.1)
and verifies the pinned SHA256 before building. Upstream source and binary
outputs are kept in ignored local storage. The generated WGT includes upstream
`LICENSE.md`, `README.ijg` and the required attribution:

**This software is based in part on the work of the Independent JPEG Group.**

The wrapper in `native/jpeg_worker.c` belongs to this project's MIT-licensed
code. libjpeg-turbo retains its own IJG and BSD-style terms; see the license
files in the downloaded release. The build uses the libjpeg API; it does not
build TurboJPEG, cjpeg or djpeg. Compiler and C library components retain their
respective licenses; generated private binaries are not published here.

## Optional development D-Bus fixture

`tools/tv-deps/package.json` pins dbus-native 0.4.0, with exact transitive
versions and integrity hashes in `package-lock.json`. `tools/prepare_tv_deps.py`
installs them in ignored local storage without lifecycle scripts or optional
native modules. Their existing copyright/license files are preserved during
local test preparation. These dependencies are not packaged or loaded by the
production sender. dbus-native uses the MIT license; transitive dependencies retain
the licenses declared in their individual packages.

One documented local change is applied to `dbus-native/lib/message.js`: reject
non-little-endian/protocol-version-1 frames and header/body lengths above
65,536 bytes before buffering their payload. Upstream notices remain intact.
The production client in `tv/fixed-dbus.js` is original project code under MIT.
It supports only bounded fixed-method messages over a Unix pathname socket with
EXTERNAL authentication. No abstract-socket addon, TCP discovery, kernel-bus
implementation or arbitrary command transport is used.
