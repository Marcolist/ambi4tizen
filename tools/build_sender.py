#!/usr/bin/env python3
"""Build and sign locally; never install or contact the TV."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from configure import load_config, PRIVATE

root=Path(__file__).resolve().parents[1]
build=root/'poc/build/sender'
if build.exists():
    shutil.rmtree(build)
build.mkdir(parents=True)
for name in ['config.xml','index.html','sender.js','protocol.js','zones.js']:
    shutil.copyfile(root/'tv'/name,build/name)
for name in ['icon.svg','capture-core.js']:
    shutil.copyfile(root/'poc/web-probe'/name,build/name)
shutil.copytree(root/'poc/web-probe/vendor',build/'vendor')
config=None
if PRIVATE.exists():
    data=load_config()
    config=dict(data['sender'],key_hex=data['key_hex'],diagnostic_token=data['api_token'])
code=(root/'tv/service.js').read_text().replace('/*__SENDER_CONFIG__*/null',json.dumps(config))
assert '/*__SENDER_CONFIG__*/' not in code
(build/'service.js').write_text(code)
output=root/'poc/build/ambilight-sender.wgt'
env=os.environ.copy()
env.update(DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_CLI_HOME=str(root/'.local/dotnet-home'),NUGET_PACKAGES=str(root/'.local/nuget'))
subprocess.run([str(root/'.local/dotnet/dotnet'),'msbuild',str(root/'tools/WidgetSigner.proj'),
                '-t:SignProbeWidget','-p:ProbeWidgetDir='+str(build),'-p:ProbeWidgetOutput='+str(output),'-nologo'],env=env,check=True)
with zipfile.ZipFile(output) as z:
    assert {'config.xml','signature1.xml','author-signature.xml','capture-core.js','vendor/NOTICE.txt'} <= set(z.namelist())
    assert z.read('service.js').decode()==code
print('Signed sender built locally; enabled:',bool(config and config['enabled']))
print('Bytes:',output.stat().st_size,'SHA256:',hashlib.sha256(output.read_bytes()).hexdigest())
