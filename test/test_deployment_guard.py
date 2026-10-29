#!/usr/bin/env python3
"""All deployment I/O mocked: no TV or SDB is contacted."""
from pathlib import Path
import importlib.util
import io
import json
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy',ROOT/'poc/deploy_web_probe.py')
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)


class DeploymentGuard(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        local=self.root/'.local';local.mkdir()
        self.target={'host':'192.0.2.2','name':'fixture-TV','modelName':'fixture-model','wifiMac':'00:11:22:33:44:55'}
        (local/'target.json').write_text(json.dumps(self.target))
        self.private={'firmware':{'source_ip':self.target['host']},'sender':{'enabled':False},'api_token':'test-only'}
        self.path=local/'ambilight-config.json';self.path.write_text(json.dumps(self.private))

    def tearDown(self):self.temp.cleanup()

    def run_guard(self,args,error):
        with patch.object(deploy,'ROOT',self.root),patch('sys.argv',['deploy',*args]),patch.object(deploy.urllib.request,'urlopen') as network,patch.object(deploy.subprocess,'run') as sdb:
            with self.assertRaisesRegex(ValueError,error):deploy.main()
            network.assert_not_called();sdb.assert_not_called()

    def test_disabled_cannot_launch(self):self.run_guard(['launch','--sender'],'disabled')
    def test_no_sender_capture_route(self):self.run_guard(['capture','--sender'],'supports only')
    def test_source_must_match_pin(self):
        self.private['firmware']['source_ip']='192.0.2.3';self.path.write_text(json.dumps(self.private))
        self.run_guard(['install','--sender'],'must match')

    def test_wrong_tv_cannot_install(self):
        wrong=dict(self.target,modelName='wrong-model',developerMode='1')
        response=io.BytesIO(json.dumps({'device':wrong}).encode())
        with patch.object(deploy,'ROOT',self.root),patch('sys.argv',['deploy','install','--sender']),patch.object(deploy.urllib.request,'urlopen',return_value=response),patch.object(deploy.subprocess,'run') as sdb:
            with self.assertRaisesRegex(ValueError,'Target mismatch'):deploy.main()
            sdb.assert_not_called()


if __name__=='__main__':unittest.main()
