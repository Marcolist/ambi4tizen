#!/usr/bin/env python3
"""Build the optional stdin-only JPEG worker privately. Never contacts a TV."""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = '3.2.1'
SHA256 = 'c27ad72a68da151177929aa969ae773a2da5ac2af9ce946079314fdac8cece7f'
URL = f'https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/{VERSION}/libjpeg-turbo-{VERSION}.tar.gz'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target', choices=('host', 'armv7'), default='host')
    a = p.parse_args()
    base = ROOT / '.local/tv-native'
    base.mkdir(parents=True, exist_ok=True)
    archive = base / f'libjpeg-turbo-{VERSION}.tar.gz'
    source = base / f'libjpeg-turbo-{VERSION}'
    with (base / 'source.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not archive.exists():
            temporary = archive.with_suffix('.download')
            urllib.request.urlretrieve(URL, temporary)
            temporary.replace(archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
            raise SystemExit('Upstream source checksum mismatch')
        if not (source / '.unpacked').exists():
            if source.exists():
                shutil.rmtree(source)
            with tarfile.open(archive) as t:
                t.extractall(base, filter='data')
            (source / '.unpacked').touch()
    output = base / a.target
    build = output / 'jpeg-build'
    cc = 'arm-linux-gnueabihf-gcc' if a.target == 'armv7' else 'cc'
    if not shutil.which(cc):
        raise SystemExit(f'{cc} is required; no packages are installed automatically')
    args = ['cmake', '-S', str(source), '-B', str(build), '-DENABLE_SHARED=OFF',
            '-DENABLE_STATIC=ON', '-DWITH_TURBOJPEG=OFF', '-DCMAKE_BUILD_TYPE=Release',
            '-DCMAKE_C_COMPILER=' + cc]
    if a.target == 'armv7':
        args += ['-DCMAKE_SYSTEM_NAME=Linux', '-DCMAKE_SYSTEM_PROCESSOR=arm',
                 '-DCMAKE_C_FLAGS=-march=armv7-a -mfpu=neon -mfloat-abi=hard']
    else:
        args += ['-DWITH_SIMD=OFF']
    subprocess.run(args, check=True)
    subprocess.run(['cmake', '--build', str(build), '--target', 'jpeg-static', '-j', '2'], check=True)
    binary = output / 'ambi-jpeg'
    flags = ['-static'] if a.target == 'armv7' else []
    subprocess.run([cc, '-O2', *flags, '-I', str(source / 'src'), '-I', str(build),
                    str(ROOT / 'native/jpeg_worker.c'), str(build / 'libjpeg.a'), '-lm', '-o', str(binary)], check=True)
    licenses = base / 'licenses'
    licenses.mkdir(exist_ok=True)
    for name in ('LICENSE.md', 'README.ijg'):
        shutil.copy2(source / name, licenses / name)
    (licenses / 'NOTICE.txt').write_text('This software is based in part on the work of the Independent JPEG Group.\n')
    (output / 'manifest.json').write_text(json.dumps({
        'target': a.target, 'upstream': VERSION, 'source_url': URL, 'source_sha256': SHA256,
        'worker_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
        'worker_source_sha256': hashlib.sha256((ROOT / 'native/jpeg_worker.c').read_bytes()).hexdigest(),
        'protocol': 'AJP1', 'requires_neon': a.target == 'armv7',
    }, indent=2) + '\n')
    print('Built:', binary.relative_to(ROOT))


if __name__ == '__main__':
    main()
