#!/usr/bin/env python3
"""Independent UDP pattern generator. Defaults to loopback; never captures TV images."""
import argparse
import hashlib
import hmac
import ipaddress
import math
import secrets
import socket
import struct
import time
from pathlib import Path


def encode(key, session, sequence, capture_ms, age_ms, sections, colors, brightness=255):
    if len(key)!=32 or not any(key) or len(session)!=8 or not any(session):
        raise ValueError('nonzero key/session required')
    if len(sections)!=3 or min(sections)<1 or sum(sections)!=len(colors) or not 3<=len(colors)<=24:
        raise ValueError('layout')
    header=struct.pack('>4sBBH8sIIHBBBBBB',b'AMB1',1,1,len(colors),session,sequence,capture_ms,age_ms,
                       brightness,*sections,0,0)
    body=header+bytes(channel for rgb in colors for channel in rgb)
    return body+hmac.new(key,body,hashlib.sha256).digest()[:16]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--key-file',type=Path,required=True)
    p.add_argument('--host',default='127.0.0.1')
    p.add_argument('--port',type=int,default=19446)
    p.add_argument('--seconds',type=float,default=10)
    p.add_argument('--zones',type=int,choices=[6,12,18,24],default=12)
    p.add_argument('--brightness',type=int,default=32)
    p.add_argument('--allow-lan',action='store_true',help='explicitly allow transmission to hardware; requires prior wiring review/approval')
    a=p.parse_args();addr=ipaddress.IPv4Address(a.host)
    if not addr.is_loopback and not a.allow_lan:
        p.error('LAN transmission requires --allow-lan after hardware approval')
    if addr.is_multicast or addr.is_unspecified or not 1024<=a.port<=65535 or not 0<a.seconds<=60 or not 0<=a.brightness<=255:
        p.error('invalid destination/window/brightness')
    key=bytes.fromhex(a.key_file.read_text().strip())
    session=secrets.token_bytes(8);sections={6:[2,2,2],12:[3,6,3],18:[5,8,5],24:[6,12,6]}[a.zones]
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
    start=time.monotonic();seq=0
    try:
        while time.monotonic()-start<a.seconds:
            now=time.monotonic();phase=now-start
            colors=[[round((math.sin(phase+i*.3+c*2.094)+1)*127.5) for c in range(3)] for i in range(a.zones)]
            packet=encode(key,session,seq,int(now*1000)&0xffffffff,0,sections,colors,a.brightness)
            sock.sendto(packet,(a.host,a.port));seq=(seq+1)&0xffffffff;time.sleep(.1)
    finally:
        sock.close()
    print('Pattern packets sent:',seq)


if __name__=='__main__':
    main()
