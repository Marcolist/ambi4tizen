#!/usr/bin/env python3
"""Check the actual release ZIP, replacement contract and local test feed."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_catalog import build
from catalog_test_feed import documents


class CatalogBuild(unittest.TestCase):
    def test_generic_reproducible_package(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'public.wgt'
            first = build(output).read_bytes()
            self.assertEqual(first, build(output).read_bytes())
            with zipfile.ZipFile(output) as package:
                self.assertEqual(set(package.namelist()), {
                    'config.xml', 'service.js', 'index.html', 'receiver-config.js',
                    'sender.js', 'protocol.js', 'zones.js', 'capture-core.js', 'icon.svg',
                    'vendor/jpeg-decoder.js', 'vendor/LICENSE.jpeg-js', 'vendor/LICENSE.Apache-2.0', 'vendor/NOTICE.txt',
                    'LICENSE', 'THIRD_PARTY_NOTICES.md'})
                service = package.read('service.js').decode()
                spec = json.loads((ROOT / 'distribution/apps2samsung/Marcolist__ambi4tizen.json').read_text())['user_settings']
                for field in spec['fields']:
                    self.assertEqual(service.count(field['find']), 1)
                for forbidden in ('developer_ip', 'diagnostic_token', 'capture_enabled', "require('http')"):
                    self.assertNotIn(forbidden, service)
                ns = {'w': 'http://www.w3.org/ns/widgets', 't': 'http://tizen.org/ns/widgets'}
                config = ET.fromstring(package.read('config.xml'))
                self.assertEqual(config.get('version'), '0.4.0')
                self.assertEqual(config.find('w:name', ns).text, 'Ambi4Tizen')
                self.assertEqual(config.find('t:application', ns).get('required_version'), '4.0')
                self.assertEqual(config.find('t:service', ns).get('auto-restart'), 'false')
                # Look for private values without ever putting them in failure output.
                private = ROOT / '.local/ambilight-config.json'
                if private.exists():
                    content = b'\n'.join(package.read(name) for name in package.namelist())
                    values = json.loads(private.read_text())
                    def scan(value, key=''):
                        if isinstance(value, dict):
                            for name, child in value.items():
                                scan(child, name)
                        elif isinstance(value, str) and (key in ('key_hex', 'api_token', 'diagnostic_token', 'password', 'ssid', 'esp_ip', 'developer_ip', 'source_ip')) and len(value) >= 5:
                            self.assertFalse(value.encode() in content, 'Private value present in public package')
                    scan(values)
                feed = documents('http://127.0.0.1:18794', first)
                self.assertEqual(len(feed), 4)
                catalog = json.loads(feed['/catalog.json'][1])
                self.assertEqual(catalog['apps'][0]['user_settings'], spec)
                self.assertEqual(feed['/ambi4tizen-catalog.wgt'][1], first)

    def test_upstream_schema_when_available(self):
        schema = ROOT / '.local/apps2samsung/packages.schema.json'
        if not schema.exists() or importlib.util.find_spec('jsonschema') is None:
            self.skipTest('Optional upstream schema/jsonschema is not installed')
        import jsonschema
        manifest = json.loads((ROOT / 'distribution/apps2samsung/Marcolist__ambi4tizen.json').read_text())
        jsonschema.Draft202012Validator(json.loads(schema.read_text())).validate(manifest)


if __name__ == '__main__':
    unittest.main()
