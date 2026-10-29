#!/usr/bin/env python3
"""Generate private diagnostic configuration; never overwrite existing access."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import secrets
import urllib.request

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--tv', required=True, help='Explicit target TV IPv4 address')
parser.add_argument('--host', required=True, help='Developer computer LAN IPv4 address')
args = parser.parse_args()
for value in [args.tv, args.host]:
    address = ipaddress.IPv4Address(value)
    if not address.is_private or address.is_loopback or address.is_unspecified:
        raise ValueError('Use private LAN IPv4 addresses')
local = root / '.local'
local.mkdir(mode=0o700, exist_ok=True)
paths = [local / name for name in ['target.json', 'probe-access.txt', 'probe-access.g.cs']]
if any(path.exists() for path in paths):
    raise SystemExit('Existing configuration preserved. Review it locally before replacement.')
with urllib.request.urlopen('http://' + args.tv + ':8001/api/v2/', timeout=5) as response:
    device = json.load(response)['device']
if device.get('developerMode') != '1':
    raise SystemExit('Developer mode is not active')
target = dict((field, device[field]) for field in ['name', 'modelName', 'wifiMac'])
target['host'] = args.tv
token = secrets.token_hex(24)
contents = [json.dumps(target, indent=2) + '\n', token + '\n' + args.host + '\n',
    'namespace AmbilightProbe { internal static class ProbeAccess { internal const string Token = "' + token + '"; internal const string Host = "' + args.host + '"; } }\n']
for path, content in zip(paths, contents):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as handle:
        handle.write(content)
print('Private target pin and diagnostic access generated; no TV changes made.')
