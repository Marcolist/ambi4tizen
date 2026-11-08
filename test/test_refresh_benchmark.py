#!/usr/bin/env python3
"""Check profile isolation and counter-based measurement without contacting devices."""
import importlib.util
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('benchmark', ROOT / 'tools/benchmark_refresh.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class Benchmark(unittest.TestCase):
    def test_failed_preflight_restores_config_and_working_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'poc/build/ambilight-sender.wgt'
            package.parent.mkdir(parents=True)
            package.write_bytes(b'original build output')
            private = root / '.local/config.json'
            private.parent.mkdir()
            original = dict(api_token='synthetic', sender=dict(enabled=True, esp_ip='192.0.2.3'))
            private.write_text(json.dumps(original) + '\n')
            original_bytes = private.read_bytes()
            (root / '.local/target.json').write_text('{"host":"192.0.2.2"}')
            rollback = root / '.local/working.wgt'
            rollback.write_bytes(b'known working signed package')
            deployments = []

            def execute(argv, **kwargs):
                if argv[1] == 'tools/build_sender.py':
                    package.write_bytes(b'candidate package')
                else:
                    deployments.append((argv[2], package.read_bytes()))

            argv = ['benchmark', '--run', '--profile', 'baseline', '--seconds', '10',
                    '--rollback-package', str(rollback)]
            with patch.object(benchmark, 'ROOT', root), patch.object(benchmark, 'PRIVATE', private), \
                 patch.object(benchmark, 'PACKAGE', package), patch.object(benchmark, 'load_config', return_value=original), \
                 patch.object(benchmark.subprocess, 'run', side_effect=execute), \
                 patch.object(benchmark.urllib.request, 'urlopen', side_effect=OSError('preflight failed')), \
                 patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(OSError):
                    benchmark.main()
            self.assertEqual(private.read_bytes(), original_bytes)
            self.assertEqual(package.read_bytes(), b'original build output')
            self.assertEqual([action for action, _ in deployments], ['install', 'launch', 'install', 'launch'])
            self.assertEqual(deployments[-1][1], b'known working signed package')
            result = json.loads(next(root.glob('.local/refresh-benchmarks/*/results.json')).read_text())
            self.assertFalse(result['live_test_passed'])
            self.assertEqual(result['rollback'], 'working package reinstalled and launched')

    def test_profiles_preserve_credentials_and_original(self):
        original = dict(api_token='synthetic', sender=dict(enabled=False, zones=12), firmware=dict(gpio=18))
        profile = benchmark.profile_config(original, 'pipeline', 30)
        self.assertFalse(original['sender']['enabled'])
        self.assertEqual(original['sender'], dict(enabled=False, zones=12))
        self.assertEqual(profile['firmware'], original['firmware'])
        self.assertEqual(profile['api_token'], 'synthetic')
        self.assertEqual(profile['sender']['duration_ms'], 45000)
        self.assertTrue(profile['sender']['pipeline'])
        profile['firmware']['gpio'] = 21
        self.assertEqual(original['firmware']['gpio'], 18)

    def test_rate_uses_counters_not_polled_samples(self):
        before = dict(sent=20, errors=1, profiles=dict(broker=dict(count=20, sum_ms=2000)))
        after = dict(sent=120, errors=1, profiles=dict(broker=dict(count=120, sum_ms=10000)))
        summary = benchmark.summarize(before, after, 10, [20, 30, 50])
        self.assertEqual(summary['sends_per_s'], 10)
        self.assertEqual(summary['observed_frames'], 3)
        self.assertEqual(summary['mean_stage_ms']['broker'], 80)
        self.assertEqual(summary['new_errors'], 0)


if __name__ == '__main__':
    unittest.main()
