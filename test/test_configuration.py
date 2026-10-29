#!/usr/bin/env python3
from copy import deepcopy
from pathlib import Path
import importlib.util
import json
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('configure',ROOT/'tools/configure.py')
configure=importlib.util.module_from_spec(spec);spec.loader.exec_module(configure)


class Configuration(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'config.json'
        self.data=json.loads((ROOT/'tools/config.example.json').read_text())
        self.data.update(key_hex=bytes(range(32)).hex(),api_token='ab'*32,profile_id=1)

    def tearDown(self):self.temp.cleanup()

    def load(self,data):
        self.path.write_text(json.dumps(data));return configure.load_config(self.path)

    def test_defaults_disabled(self):
        data=self.load(self.data)
        self.assertFalse(data['firmware']['output_enabled']);self.assertFalse(data['sender']['enabled'])

    def test_invalid_settings(self):
        mutations=[('gpio',99),('leds_left',601),('leds_left',10),('brightness',256),('ssid','x'*33),
                   ('output_enabled',True),('reverse',1),('gamma_milli',0),('source_ip','a.b.c.d'),('timeout_ms',-1)]
        for name,value in mutations:
            with self.subTest(name=name):
                data=deepcopy(self.data);data['firmware'][name]=value
                with self.assertRaises(ValueError):self.load(data)

    def test_enable_needs_complete_configuration(self):
        data=deepcopy(self.data);data['sender']['enabled']=True
        with self.assertRaises(ValueError):self.load(data)
        data['firmware'].update(ssid='test',source_ip='192.0.2.2',leds_left=5,leds_top=10,leds_right=5,gpio=18,output_enabled=True)
        data['sender'].update(esp_ip='192.0.2.3',developer_ip='192.0.2.4')
        self.assertTrue(self.load(data)['sender']['enabled'])

    def test_init_does_not_overwrite_credentials(self):
        command=['python3',str(ROOT/'tools/configure.py'),'--init','--config',str(self.path)]
        subprocess.run(command,check=True,capture_output=True);before=self.path.read_bytes()
        self.assertEqual(self.path.stat().st_mode&0o777,0o600)
        self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
        self.assertEqual(before,self.path.read_bytes())

    def test_utf8_c_string(self):
        self.assertEqual(configure.c_string('ä"\\'), '"\\303\\244\\042\\134"')


if __name__=='__main__':unittest.main()
