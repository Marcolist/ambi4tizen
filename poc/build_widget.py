#!/usr/bin/env python3
"""Build our minimal read-only web service; use the official SDK signing task."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
token, host = (root / '.local/probe-access.txt').read_text().splitlines()
source = root / 'poc/web-probe'
build = root / 'poc/build/widget'
build.mkdir(parents=True, exist_ok=True)
for name in ['config.xml', 'index.html', 'icon.svg']:
    shutil.copyfile(source / name, build / name)
shutil.copyfile(source / 'capture.js', build / 'capture.js')
shutil.copyfile(source / 'capture-core.js', build / 'capture-core.js')
shutil.copyfile(source / 'system-info.js', build / 'system-info.js')
shutil.copytree(source / 'vendor', build / 'vendor', dirs_exist_ok=True)
code = (source / 'service.js').read_text().replace('/*__LOCAL_CONFIG__*/null', json.dumps({'token': token, 'host': host}))
assert '/*__LOCAL_CONFIG__*/' not in code
(build / 'service.js').write_text(code)
output = root / 'poc/build/ambilight-web-probe.wgt'
env = os.environ.copy()
env.update({'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'DOTNET_CLI_HOME': str(root / '.local/dotnet-home'), 'NUGET_PACKAGES': str(root / '.local/nuget')})
subprocess.run([str(root / '.local/dotnet/dotnet'), 'msbuild', str(root / 'tools/WidgetSigner.proj'),
                '-t:SignProbeWidget', '-p:ProbeWidgetDir=' + str(build), '-p:ProbeWidgetOutput=' + str(output), '-nologo'], env=env, check=True)
with zipfile.ZipFile(output) as package:
    assert 'config.xml' in package.namelist() and 'signature1.xml' in package.namelist()
    assert package.read('service.js').decode() == code
print('Built signed widget:', output.stat().st_size, 'bytes; sha256', hashlib.sha256(output.read_bytes()).hexdigest())
