#!/usr/bin/env python3
"""Operate only our temporary WGT on an identity-pinned target using normal SDB."""
import argparse
import datetime
import hashlib
import ipaddress
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['install', 'launch', 'status', 'capture', 'stop', 'metrics'])
    parser.add_argument('--context', default='unconfirmed screen content')
    parser.add_argument('--sender', action='store_true', help='separate UDP sender; install/launch require prior user approval')
    args = parser.parse_args()
    app_id, service_id, port = 'ambiProbe4.Probe', 'ambiProbe4.Service', 18792
    package_name, record_name = 'ambilight-web-probe.wgt', 'web'
    if args.sender:
        if args.action not in {'install', 'launch', 'status', 'stop'}:
            raise ValueError('Sender supports only install, launch, status and stop')
        app_id, service_id, port = 'ambiSend40.Start', 'ambiSend40.Service', 18793
        package_name, record_name = 'ambilight-sender.wgt', 'sender'
        private = json.loads((ROOT / '.local/ambilight-config.json').read_text())
        if args.action == 'launch' and not private['sender']['enabled']:
            raise ValueError('Sender is disabled; configure, rebuild and obtain approval first')
    config = json.loads((ROOT / '.local/target.json').read_text())
    host = str(ipaddress.IPv4Address(config['host']))
    if args.sender and private['firmware']['source_ip'] != host:
        raise ValueError('Sender source_ip must match the pinned TV')
    if not ipaddress.ip_address(host).is_private:
        raise ValueError('Expected private LAN target')
    with urllib.request.urlopen('http://' + host + ':8001/api/v2/', timeout=5) as response:
        device = json.load(response)['device']
    for field in ['name', 'modelName', 'wifiMac']:
        if device[field].lower() != config[field].lower():
            raise ValueError('Target mismatch: ' + field)
    if device.get('developerMode') != '1':
        raise ValueError('Developer mode is not active')
    token = private['api_token'] if args.sender else (ROOT / '.local/probe-access.txt').read_text().splitlines()[0]
    record = {'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'action': args.action, 'context': args.context, 'commands': []}

    def request(route, method='GET'):
        req = urllib.request.Request('http://' + host + ':' + str(port) + '/' + route,
            headers={'Authorization': 'Bearer ' + token}, method=method)
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.read(32768).decode('utf8', 'replace')

    def sdb(arguments):
        result = subprocess.run([str(ROOT / 'discovery/tools/sdb-sdk/tools/sdb'),
                                 '-s', host + ':26101', *arguments],
                                capture_output=True, text=True, timeout=45)
        output = result.stdout + result.stderr
        record['commands'].append({'arguments': arguments, 'exit_code': result.returncode, 'output': output})
        print('Own service inventory checked' if arguments == ['shell', '0', 'applist'] else output.strip(), flush=True)
        if result.returncode != 0:
            raise RuntimeError('SDB command failed')
        return output

    try:
        if args.action == 'install':
            try:
                request('stop', 'POST')
                time.sleep(1)
            except OSError:
                pass
            package = ROOT / 'poc/build' / package_name
            record['sha256'] = hashlib.sha256(package.read_bytes()).hexdigest()
            remote = '/home/owner/share/tmp/sdk_tools/' + package_name
            sdb(['push', str(package), remote])
            output = sdb(['shell', '0', 'vd_appinstall', app_id, remote])
            if 'install completed' not in output.lower() and 'val[ok]' not in output.lower():
                record['confirmation_requires_inventory'] = True
        elif args.action == 'launch':
            inventory = sdb(['shell', '0', 'applist'])
            if service_id not in inventory:
                raise RuntimeError('Own service not registered')
            sdb(['shell', '0', 'execute', service_id])
            for attempt in range(15):
                try:
                    record['result'] = request('status')
                    break
                except OSError:
                    time.sleep(0.3)
            else:
                raise RuntimeError('Web probe endpoint did not become ready')
        else:
            try:
                record['result'] = request(args.action, 'POST' if args.action in {'stop', 'capture'} else 'GET')
            except urllib.error.URLError as exc:
                if args.action == 'stop' and isinstance(exc.reason, ConnectionRefusedError):
                    record['result'] = 'Already closed (connection refused)'
                else:
                    raise
        if 'result' in record:
            print(record['result'])
    finally:
        output_dir = ROOT / 'poc/runtime'
        output_dir.mkdir(exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        (output_dir / (stamp + '-' + record_name + '-' + args.action + '.json')).write_text(json.dumps(record, indent=2) + '\n')


if __name__ == '__main__':
    main()
