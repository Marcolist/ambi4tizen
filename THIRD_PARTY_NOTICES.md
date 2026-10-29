# Third-party notices

## jpeg-js decoder

`poc/web-probe/vendor/jpeg-decoder.js` is derived from jpeg-js 0.4.4.
Its upstream source, pinned commit and ES5 compatibility changes are documented
in [NOTICE.txt](poc/web-probe/vendor/NOTICE.txt).

The upstream decoder carries an Apache-2.0 notice; the jpeg-js package carries
a BSD-3-Clause license. Both complete texts are included:

- [Decoder Apache-2.0 license](poc/web-probe/vendor/LICENSE.Apache-2.0)
- [jpeg-js BSD-3-Clause license](poc/web-probe/vendor/LICENSE.jpeg-js)

Original copyright and attribution remain unchanged. No TV image fixtures or
streaming content are included; tests generate their own synthetic images.

## External build dependencies

ESP-IDF, Espressif led_strip, Tizen SDK tools, signing certificates, Node.js,
OpenSSL and Python dependencies are not vendored in this source repository.
They retain their respective licenses. ESP-IDF/led_strip dependencies are
pinned in the firmware manifest/lock file. Generated packages and firmware
images are excluded from this repository.
