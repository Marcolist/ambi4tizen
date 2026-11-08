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
for name in ['config.xml','index.html','sender.js','protocol.js','zones.js','capabilities.js','fixed-dbus.js','native-decoder.js','persistent-broker.js']:
    shutil.copyfile(root/'tv'/name,build/name)
for name in ['icon.svg','capture-core.js']:
    shutil.copyfile(root/'poc/web-probe'/name,build/name)
shutil.copytree(root/'poc/web-probe/vendor',build/'vendor')
worker=Path(os.environ.get('AMBI_NATIVE_WORKER',str(root/'.local/tv-native/armv7/ambi-jpeg')))
if worker.is_file():
    elf=worker.read_bytes()
    manifest=json.loads(worker.with_name('manifest.json').read_text())
    if (elf[:6] != b'\x7fELF\x01\x01' or int.from_bytes(elf[18:20],'little') != 40
            or manifest.get('target') != 'armv7'
            or manifest.get('worker_sha256') != hashlib.sha256(elf).hexdigest()
            or manifest.get('worker_source_sha256') != hashlib.sha256((root/'native/jpeg_worker.c').read_bytes()).hexdigest()):
        raise RuntimeError('Native worker architecture/hash mismatch; rebuild tools/build_native.py --target armv7')
    (build/'native').mkdir()
    shutil.copy2(worker,build/'native/ambi-jpeg')
    licenses=root/'.local/tv-native/licenses'
    if not (licenses/'README.ijg').exists():
        raise RuntimeError('Native worker licenses missing; run tools/build_native.py')
    shutil.copytree(licenses,build/'native/licenses')
config=None
if PRIVATE.exists():
    data=load_config()
    config=dict(data['sender'],key_hex=data['key_hex'],diagnostic_token=data['api_token'])
    if config.get('decoder') == 'native' and not worker.is_file():
        raise RuntimeError('Strict native decoder requested but ARM worker is missing')
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
