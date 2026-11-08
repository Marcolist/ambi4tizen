#!/usr/bin/env python3
"""Install pinned optional TV dependencies privately, without npm lifecycle scripts."""
from pathlib import Path
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
destination = ROOT / '.local/tv-node'
destination.mkdir(parents=True, exist_ok=True)
for name in ('package.json', 'package-lock.json'):
    shutil.copy2(ROOT / 'tools/tv-deps' / name, destination / name)
subprocess.run(['npm', 'ci', '--prefix', str(destination), '--ignore-scripts',
                '--omit=optional', '--no-audit', '--no-fund'], check=True)
# The fixed capture client has no reason to accept large D-Bus frames. Preserve
# upstream notices and bound the pinned parser before it waits for a payload.
parser = destination / 'node_modules/dbus-native/lib/message.js'
source = parser.read_text()
needle = '        bodyLength = header.readUInt32LE(4);'
assert source.count(needle) == 1
source = source.replace(needle, needle + '''
        // Ambi4Tizen: bound replies/signals on the fixed local capture client.
        if (header[0] !== 108 || header[3] !== 1 || fieldsLength > 65536 || bodyLength > 65536) {
          stream.destroy(new Error('D-Bus frame exceeds capture client bounds'));
          return;
        }''')
parser.write_text(source)
(destination / 'build-info.json').write_text(json.dumps({
    'dbus-native': '0.4.0', 'npm_scripts': False, 'optional_native_modules': False,
    'parser_max_header_bytes': 65536, 'parser_max_body_bytes': 65536,
}, indent=2) + '\n')
print('Pinned TV dependencies prepared privately; abstract sockets and unixexec are not used.')
