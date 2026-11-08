#!/usr/bin/env python3
"""Real helper protocol tests, synthetic JPEG only; no TV or device files."""
from pathlib import Path
import io
import struct
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
worker = ROOT / '.local/tv-native/host/ambi-jpeg'
if not worker.exists():
    print('SKIP native worker: build with python3 tools/build_native.py --target host')
    raise SystemExit(0)
image = Image.new('RGB', (480, 270), (180, 80, 20))
out = io.BytesIO()
image.save(out, format='JPEG', quality=35)
jpeg = out.getvalue()


def frame(data, scale=4):
    return struct.pack('!II', len(data), scale) + data


requests = frame(b'not a JPEG') + frame(jpeg, 4) + frame(jpeg, 8)
run = subprocess.run([str(worker)], input=requests, capture_output=True, timeout=5)
assert run.returncode == 0
position = 0
for index in range(3):
    magic, status, w, h, sw, sh, us, n = struct.unpack_from('!4s7I', run.stdout, position)
    position += 32
    assert magic == b'AJP1'
    if index == 0:
        assert status != 0 and n == 0
    else:
        assert status == 0 and (sw, sh) == (480, 270) and n == w * h * 3
        assert (w, h) == ((120, 68) if index == 1 else (60, 34))
        pixels = run.stdout[position:position+n]
        assert all(abs(pixels[channel] - (180, 80, 20)[channel]) < 8 for channel in range(3))
    position += n
assert position == len(run.stdout)
for header in (struct.pack('!II', 2097153, 1), struct.pack('!II', 4, 3)):
    assert subprocess.run([str(worker)], input=header, capture_output=True, timeout=2).returncode != 0
assert subprocess.run([str(worker)], input=frame(jpeg)[:-20], capture_output=True, timeout=2).returncode != 0
print('PASS native worker: persistent framing, malformed JPEG recovery, scaled dimensions/colors, length and truncation bounds')
