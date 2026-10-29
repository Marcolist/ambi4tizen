#!/usr/bin/env python3
"""Local commissioning client; credentials stay in the ignored private file."""
import argparse
import ipaddress
import json
import urllib.request
from configure import load_config

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('action',choices=['status','OFF','AMBILIGHT','AMBIENT','AUTO'])
p.add_argument('--brightness',type=int)
p.add_argument('--rgb',nargs=3,type=int)
a=p.parse_args()
if a.brightness is not None and not 0<=a.brightness<=255 or a.rgb is not None and any(not 0<=c<=255 for c in a.rgb):
    p.error('brightness/RGB must be 0..255')
if a.action=='status' and (a.brightness is not None or a.rgb is not None):
    p.error('status does not change settings')
c=load_config();host=str(ipaddress.IPv4Address(c['sender']['esp_ip']))
body=None
if a.action!='status':
    command={'mode':a.action}
    if a.brightness is not None:command['brightness']=a.brightness
    if a.rgb is not None:command['ambient']=a.rgb
    body=json.dumps(command).encode()
request=urllib.request.Request('http://'+host+':8080/'+('status' if body is None else 'command'),
    data=body,headers={'Authorization':'Bearer '+c['api_token'],'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=4) as response:
    print(response.read(8192).decode())
