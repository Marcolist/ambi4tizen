#!/usr/bin/env python3
"""Build a public unsigned Apps2Samsung template without reading private config."""
import hashlib
from pathlib import Path
import shutil
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'poc/build/ambi4tizen-catalog.wgt'


def build(output=OUTPUT):
    stage = ROOT / 'poc/build/catalog'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for name in ('service.js', 'index.html', 'receiver-config.js'):
        shutil.copyfile(ROOT / 'tv/catalog' / name, stage / name)
    for name in ('sender.js', 'protocol.js', 'zones.js'):
        shutil.copyfile(ROOT / 'tv' / name, stage / name)
    for name in ('capture-core.js', 'icon.svg'):
        shutil.copyfile(ROOT / 'poc/web-probe' / name, stage / name)
    shutil.copytree(ROOT / 'poc/web-probe/vendor', stage / 'vendor')
    ns = {'w': 'http://www.w3.org/ns/widgets', 't': 'http://tizen.org/ns/widgets'}
    ET.register_namespace('', ns['w'])
    ET.register_namespace('tizen', ns['t'])
    config = ET.parse(ROOT / 'tv/config.xml').getroot()
    config.set('version', '0.4.0')
    config.find('t:application', ns).set('required_version', '4.0')
    config.find('w:name', ns).text = 'Ambi4Tizen'
    service_node = config.find('t:service', ns)
    service_node.set('auto-restart', 'false')
    service_node.find('t:description', ns).text = 'Manually started local LED color sender'
    ET.ElementTree(config).write(stage / 'config.xml', encoding='utf-8', xml_declaration=True)
    for name in ('LICENSE', 'THIRD_PARTY_NOTICES.md'):
        shutil.copyfile(ROOT / name, stage / name)
    service = (stage / 'service.js').read_text()
    for needle in ('"esp_ip": ""', '"key_hex": ""'):
        if service.count(needle) != 1:
            raise RuntimeError('Catalog replacement contract changed: ' + needle)
    if any(word in service for word in ('developer_ip', 'diagnostic_token', "require('http')", 'capture_enabled')):
        raise RuntimeError('Unexpected diagnostic/configuration gate in catalog service')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Reproducible archive: no local timestamps, certificates or permissions.
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(stage.rglob('*')):
            if path.is_file():
                entry = zipfile.ZipInfo(path.relative_to(stage).as_posix(), (2026, 1, 1, 0, 0, 0))
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(entry, path.read_bytes())
    return output


if __name__ == '__main__':
    result = build()
    print('Generic unsigned catalog template:', result.relative_to(ROOT))
    print('Bytes:', result.stat().st_size, 'SHA256:', hashlib.sha256(result.read_bytes()).hexdigest())
