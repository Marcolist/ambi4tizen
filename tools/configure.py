#!/usr/bin/env python3
"""Create private local credentials or generate a private compile-time header. Never flashes."""
from pathlib import Path
import argparse
import ipaddress
import json
import secrets

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.local/ambilight-config.json'


def load_config(path=PRIVATE):
    data = json.loads(Path(path).read_text())
    fw, sender = data['firmware'], data['sender']
    for name in ('key_hex', 'api_token'):
        value = data[name]
        if len(value) != 64 or any(c not in '0123456789abcdef' for c in value) or int(value, 16) == 0:
            raise ValueError('invalid private credential: ' + name)
    if type(data['profile_id']) is not int or not 0 < data['profile_id'] <= 0xffffffff:
        raise ValueError('profile_id')
    ranges = {'leds_left': (0,600), 'leds_top': (0,600), 'leds_right': (0,600), 'start_offset': (0,599),
              'gpio': (-1,33), 'brightness': (0,255), 'brightness_cap': (0,255), 'current_limit_ma': (0,30000),
              'white_pixel_ma': (1,100), 'gamma_milli': (1000,4000), 'smoothing_ms': (0,3000),
              'timeout_ms': (500,30000), 'max_age_ms': (100,5000), 'max_lag_ms': (50,5000), 'udp_port': (1024,65535)}
    if set(fw) != set(ranges) | {'ssid','password','source_ip','reverse','output_enabled'}:
        raise ValueError('unknown or missing firmware setting')
    for name, (lo, hi) in ranges.items():
        if type(fw[name]) is not int or not lo <= fw[name] <= hi:
            raise ValueError(name)
    n = sum(fw[name] for name in ('leds_left','leds_top','leds_right'))
    if n > 600 or (n and min(fw['leds_left'],fw['leds_top'],fw['leds_right']) == 0) or fw['start_offset'] >= max(1,n):
        raise ValueError('LED layout')
    for name in ('reverse','output_enabled'):
        if type(fw[name]) is not bool:
            raise ValueError(name)
    for name, limit in [('ssid',32),('password',64),('source_ip',15)]:
        if not isinstance(fw[name],str) or '\0' in fw[name] or len(fw[name].encode()) > limit:
            raise ValueError(name)
    if fw['source_ip']:
        ipaddress.IPv4Address(fw['source_ip'])
    if fw['output_enabled'] and (not n or fw['gpio'] not in [4,13,14,18,19,21,22,23,25,26,27,32,33] or fw['current_limit_ma'] <= n):
        raise ValueError('LED output needs verified pin, layout and sufficient current budget')
    if type(sender['enabled']) is not bool:
        raise ValueError('enabled')
    if sender['enabled']:
        for name in ('esp_ip','developer_ip'):
            addr=ipaddress.IPv4Address(sender[name])
            if addr.is_multicast or addr.is_unspecified or sender[name].split('.')[-1] in ('0','255'):
                raise ValueError('unicast IPv4 required')
        if not fw['source_ip'] or not fw['ssid']:
            raise ValueError('TV source IP and Wi-Fi required')
    if sender['port'] != fw['udp_port'] or sender['zones'] not in (6,12,18,24) or sender['resolution'] not in ('480x270','320x180','160x90'):
        raise ValueError('sender layout/transport')
    for name,lo,hi in [('interval_ms',500,10000),('duration_ms',1000,3600000)]:
        if type(sender[name]) is not int or not lo <= sender[name] <= hi:
            raise ValueError(name)
    if not isinstance(sender['edge_depth'],(int,float)) or not .02 <= sender['edge_depth'] <= .25:
        raise ValueError('edge_depth')
    return data


def c_string(value):
    # UTF-8 bytes encoded as octal avoids ambiguous C hex escapes and non-ASCII compiler settings.
    return '"' + ''.join('\\%03o' % byte for byte in value.encode()) + '"'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--init',action='store_true')
    parser.add_argument('--config',type=Path,default=PRIVATE)
    args=parser.parse_args()
    if args.init:
        if args.config.exists():
            raise SystemExit('Configuration exists; refusing to overwrite credentials.')
        data=json.loads((ROOT/'tools/config.example.json').read_text())
        data.update(key_hex=secrets.token_hex(32),api_token=secrets.token_hex(32),profile_id=secrets.randbelow(0xffffffff)+1)
        args.config.parent.mkdir(parents=True,exist_ok=True)
        with args.config.open('x') as f:
            f.write(json.dumps(data,indent=2)+'\n')
        args.config.chmod(0o600)
        print('Private configuration initialized; sender and LEDs disabled.')
        return
    data=load_config(args.config)
    lines=['#pragma once','#include <string.h>','static void ambi_private_config(ambi_config_t *c) {',
           '    c->profile_id = %du;' % data['profile_id']]
    for name,value in data['firmware'].items():
        if isinstance(value,str):
            lines.append('    memcpy(c->%s, %s, %d);' % (name,c_string(value),len(value.encode())+1))
        else:
            lines.append('    c->%s = %s;' % (name,str(value).lower()))
    lines.append('    memcpy(c->api_token, %s, 65);' % c_string(data['api_token']))
    lines.append('    const uint8_t key[32] = {'+', '.join(str(v) for v in bytes.fromhex(data['key_hex']))+'};')
    lines.extend(['    memcpy(c->key, key, 32);','}'])
    out=ROOT/'firmware/main/private_config.h'
    out.write_text('\n'.join(lines)+'\n');out.chmod(0o600)
    print('Private header generated. No build, installation or hardware access performed.')


if __name__ == '__main__':
    main()
