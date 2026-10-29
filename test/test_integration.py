#!/usr/bin/env python3
"""Real UDP/cross-language test, loopback only, no serial or TV access."""
from pathlib import Path
import importlib.util
import json
import os
import socket
import subprocess
import sys
import time
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
output=ROOT/'test/output';output.mkdir(parents=True,exist_ok=True)
image=Image.new('RGB',(160,90));colors=[(255,0,0),(0,255,0),(0,255,255),(0,0,255),(255,0,255),(255,255,0)]
for y in range(90):
    for x in range(160):image.putpixel((x,y),colors[(y//45)*3+min(x*3//160,2)])
image.save(output/'fixture.jpg',quality=95,subsampling=0)
key=bytes(range(32));keyfile=output/'test-psk.hex';keyfile.write_text(key.hex()+'\n');keyfile.chmod(0o600)
node=os.environ.get('AMBI_NODE','node')
subprocess.run([node,'test/test_tv.js'],check=True)
old=ROOT/'.local/node-v4.4.3-linux-x64/bin/node'
if old.exists() and str(old)!=node:
    subprocess.run([str(old),'test/test_tv.js'],check=True)
else:
    print('Node 4.4.3 compatibility run skipped: local runtime missing')
spec=importlib.util.spec_from_file_location('pattern',ROOT/'tools/pattern_sender.py');pattern=importlib.util.module_from_spec(spec);spec.loader.exec_module(pattern)
sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
receiver=subprocess.Popen(['test/build/receiver_sim',str(keyfile),str(port),'6','3','6','3'],stdout=subprocess.PIPE,text=True)
try:
    ready=json.loads(receiver.stdout.readline());assert ready['ready']
    tx=subprocess.run([str(old) if old.exists() else node,'test/loopback_sender.js',str(port),str(keyfile)],check=True,capture_output=True,text=True)
    metrics=json.loads(tx.stdout);assert metrics['sent']>=2 and metrics['errors']==0
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
    # Separate Python encoder/authentication implementation: valid new session is
    # rejected while TV sender owns the stream, then accepted after timeout.
    def send(packet):sock.sendto(packet,('127.0.0.1',port));time.sleep(.03)
    py_session=b'PYTHON01';stamp=int(time.monotonic()*1000)&0xffffffff
    rgb=[[255,0,0],[0,255,0],[0,0,255]]
    golden=pattern.encode(key,py_session,1,stamp,0,[1,1,1],rgb)
    send(golden) # session busy
    send(golden[:-1]+bytes([golden[-1]^1])) # bad HMAC
    send(b'x'*121) # oversized
    send(pattern.encode(key,py_session,2,stamp,1501,[1,1,1],rgb)) # stale capture
    time.sleep(2.8)
    stamp=int(time.monotonic()*1000)&0xffffffff
    accepted=pattern.encode(key,py_session,3,stamp,0,[1,1,1],rgb)
    send(accepted);send(accepted) # duplicate
    sock.close()
    rows=[json.loads(line) for line in receiver.stdout]
    assert receiver.wait(timeout=2)==0
    assert rows[-1]['done'] and rows[-1]['accepted']==metrics['sent']+1 and rows[-1]['rejected']==5,rows[-1]
    # Pixels from actual JS capture->decoder->edge zones, before independent pattern.
    first=next(row for row in rows if row.get('accepted',0)==1)
    assert first['pixels'][0][2]>220 and first['pixels'][-1][0]>220 and first['pixels'][-1][1]>220,first
    assert any(row.get('mode')==0 and row.get('elapsed_ms',0)>=3000 and row.get('accepted')==metrics['sent'] for row in rows),rows
    assert any(row.get('pixels',[])[0]==[255,0,0] for row in rows if row.get('accepted')==metrics['sent']+1)
    print('PASS loopback: Node sender -> UDP -> actual C receiver/render, Python encoder interoperability, 5 invalid/stale/replay rejections and timeout OFF')
finally:
    if receiver.poll() is None:receiver.kill();receiver.wait()
