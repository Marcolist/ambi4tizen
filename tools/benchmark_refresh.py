#!/usr/bin/env python3
"""Prepare or run bounded TV comparisons; restore the supplied working package."""
import argparse
from copy import deepcopy
import datetime
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

from configure import load_config, PRIVATE

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / 'poc/build/ambilight-sender.wgt'
PROFILES = {
    'baseline': dict(jpeg_quality=55, resolution='480x270', decoder='js',
                     broker='process', decode_scale=1, pipeline=False),
    'quality': dict(jpeg_quality=35, resolution='480x270', decoder='js',
                    broker='process', decode_scale=1, pipeline=False),
    'size': dict(jpeg_quality=35, resolution='160x90', decoder='js',
                 broker='process', decode_scale=1, pipeline=False),
    'native': dict(jpeg_quality=35, resolution='160x90', decoder='native',
                   broker='process', decode_scale=4, pipeline=False),
    'bus': dict(jpeg_quality=35, resolution='160x90', decoder='native',
                broker='persistent', decode_scale=4, pipeline=False),
    'pipeline': dict(jpeg_quality=35, resolution='160x90', decoder='native',
                     broker='persistent', decode_scale=4, pipeline=True),
    'auto': dict(jpeg_quality=35, resolution='160x90', decoder='auto',
                 broker='auto', decode_scale=4, pipeline=True),
}


def profile_config(original, name, seconds):
    config = deepcopy(original)
    config['sender'].update(PROFILES[name], interval_ms=100,
                            duration_ms=(seconds + 15) * 1000, enabled=True)
    return config


def private_json(path, data):
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(json.dumps(data, indent=2) + '\n')


def summarize(before, after, elapsed, ages):
    profiles = {}
    for key, value in after.get('profiles', {}).items():
        previous = before.get('profiles', {}).get(key, {})
        count = value['count'] - previous.get('count', 0)
        if count:
            profiles[key] = (value['sum_ms'] - previous.get('sum_ms', 0)) / count
    ages = sorted(ages)
    return dict(elapsed_s=elapsed, sends_per_s=(after['sent'] - before['sent']) / elapsed,
                new_errors=after['errors'] - before['errors'], mean_stage_ms=profiles,
                sampled_age_median_ms=ages[len(ages)//2] if ages else None,
                sampled_age_p95_ms=ages[min(len(ages)-1, int(len(ages)*.95))] if ages else None,
                observed_frames=len(ages), last_sent=after.get('last_sent'),
                memory=after.get('memory'), capture_engine=after.get('capture_engine'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=PROFILES, action='append', help='repeat to select profiles; default all')
    parser.add_argument('--seconds', type=int, default=30)
    parser.add_argument('--run', action='store_true', help='install/launch the selected bounded runs on the pinned TV')
    parser.add_argument('--rollback-package', type=Path, help='known working signed WGT, required with --run')
    args = parser.parse_args()
    if not 10 <= args.seconds <= 120:
        parser.error('--seconds must be 10..120')
    if args.run and (not args.rollback_package or not args.rollback_package.is_file()):
        parser.error('--run requires an existing known working --rollback-package')
    original = load_config()
    if args.run and not original['sender']['enabled']:
        parser.error('The existing private sender must already be commissioned/enabled')
    names = args.profile or list(PROFILES)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = ROOT / '.local/refresh-benchmarks' / stamp
    output.mkdir(parents=True, mode=0o700)
    private_json(output / 'original-config.json', original)
    original_bytes = PRIVATE.read_bytes()
    prior_package = PACKAGE.read_bytes() if PACKAGE.exists() else None
    rollback = args.rollback_package.read_bytes() if args.run else None
    if rollback:
        (output / 'rollback.wgt').write_bytes(rollback)
        (output / 'rollback.wgt').chmod(0o600)
    records = dict(live_test_passed=False, note='Human playback, colors, letterbox and delay confirmation required', profiles={})

    def command(argv, logfile):
        with logfile.open('ab') as log:
            subprocess.run(argv, cwd=ROOT, check=True, stdout=log, stderr=subprocess.STDOUT, timeout=120)

    def deploy(action):
        command(['python3', 'poc/deploy_web_probe.py', action, '--sender', '--context',
                 'Bounded refresh comparison; restore working sender afterward'], output / 'deployment.log')

    def request(host, port, route):
        req = urllib.request.Request('http://' + host + ':' + str(port) + '/' + route,
                                     headers={'Authorization': 'Bearer ' + original['api_token']})
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read(65536))

    changed = False
    try:
        # All packages are built before the first TV mutation. No secrets are printed.
        for name in names:
            private_json(PRIVATE, profile_config(original, name, args.seconds))
            load_config()
            command(['python3', 'tools/build_sender.py'], output / (name + '-build.log'))
            shutil.copy2(PACKAGE, output / (name + '.wgt'))
            (output / (name + '.wgt')).chmod(0o600)
        if not args.run:
            print('Prepared private comparison packages:', output.relative_to(ROOT))
            return
        target = json.loads((ROOT / '.local/target.json').read_text())['host']
        for name in names:
            private_json(PRIVATE, profile_config(original, name, args.seconds))
            shutil.copy2(output / (name + '.wgt'), PACKAGE)
            changed = True  # An interrupted install still requires a recovery attempt.
            deploy('install')
            deploy('launch')
            capabilities = request(target, 18793, 'capabilities')
            before = request(target, 18793, 'status')
            receiver_before = request(original['sender']['esp_ip'], 8080, 'status')
            start = time.monotonic()
            seen, ages = set(), []
            while time.monotonic() - start < args.seconds:
                time.sleep(.2)
                after = request(target, 18793, 'status')
                if not after['running'] or after['errors'] != before['errors']:
                    raise RuntimeError('Capture stopped or reported an error; restoring working sender')
                frame = after.get('last_sent')
                if frame and frame['sequence'] not in seen:
                    seen.add(frame['sequence'])
                    ages.append(frame['age_ms'])
            elapsed = time.monotonic() - start
            receiver_after = request(original['sender']['esp_ip'], 8080, 'status')
            records['profiles'][name] = dict(settings=PROFILES[name], capabilities=capabilities,
                before=before, after=after, receiver_before=receiver_before, receiver_after=receiver_after,
                summary=summarize(before, after, elapsed, ages))
            rx_delta = {key: receiver_after['rx'][key] - receiver_before['rx'][key]
                        for key in ('accepted', 'invalid', 'unauthorized', 'stale', 'socket_errors')}
            records['profiles'][name]['summary']['receiver_delta'] = rx_delta
            private_json(output / 'results.json', records)
            if any(rx_delta[key] for key in ('invalid', 'unauthorized', 'stale', 'socket_errors')) or rx_delta['accepted'] <= 0:
                raise RuntimeError('Receiver rejected frames or received none; restoring working sender')
            print(name + ': %.2f sends/s, %d new sender errors' %
                  (records['profiles'][name]['summary']['sends_per_s'], records['profiles'][name]['summary']['new_errors']))
    finally:
        # Config/package are restored even on Ctrl-C. A powered-off TV may prevent
        # remote recovery; preserve that failure explicitly instead of claiming success.
        PRIVATE.write_bytes(original_bytes)
        PRIVATE.chmod(0o600)
        try:
            if changed:
                PACKAGE.write_bytes(rollback)
                deploy('install')
                deploy('launch')
                records['rollback'] = 'working package reinstalled and launched'
        except Exception as error:
            records['rollback'] = 'FAILED: ' + type(error).__name__
            print('Working sender could not be restored on TV; see private deployment.log')
            raise
        finally:
            if prior_package is None:
                PACKAGE.unlink(missing_ok=True)
            else:
                PACKAGE.write_bytes(prior_package)
            private_json(output / 'results.json', records)
    print('Comparisons recorded privately; working sender restored. Human live test is still required.')


if __name__ == '__main__':
    main()
