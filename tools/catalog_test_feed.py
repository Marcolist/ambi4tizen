#!/usr/bin/env python3
"""Serve only the generic package and test catalog on loopback before a release."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_catalog import build, ROOT


def documents(base, package):
    manifest = json.loads((ROOT / 'distribution/apps2samsung/Marcolist__ambi4tizen.json').read_text())
    digest = 'sha256:' + hashlib.sha256(package).hexdigest()
    entry = {key: manifest[key] for key in ('name', 'description', 'category', 'repo', 'user_settings')}
    entry.update(file='ambi4tizen-catalog.wgt', version='0.4.0', required_version='4.0',
                 app_id='ambiSend40.Start', package_id='ambiSend40')
    feed = {'schemaVersion': 1, 'providers': [{
        'id': 'ambi4tizen-local-test', 'displayName': 'Ambi4Tizen local test',
        'url': base + '/release.json', 'take': 1, 'expandAssets': True, 'category': 'tools'}]}
    release = {'name': 'Ambi4Tizen local test', 'tag_name': 'v0.4.0-local',
               'published_at': '2026-01-01T00:00:00Z', 'draft': False,
               'url': base + '/release.json', 'assets': [
                   {'name': 'ambi4tizen-catalog.wgt', 'browser_download_url': base + '/ambi4tizen-catalog.wgt',
                    'size': len(package), 'digest': digest},
                   {'name': 'catalog.json', 'browser_download_url': base + '/catalog.json'}]}
    values = {'/feed.json': feed, '/release.json': release,
              '/catalog.json': {'schemaVersion': 1, 'categories': {'tools': 'Tools'}, 'apps': [entry]}}
    result = {path: ('application/json', json.dumps(value).encode()) for path, value in values.items()}
    result['/ambi4tizen-catalog.wgt'] = ('application/octet-stream', package)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18794)
    args = parser.parse_args()
    # No directory serving: private files, certificates and credentials are unreachable.
    package = build().read_bytes()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in self.server.documents:
                self.send_error(404)
                return
            kind, data = self.server.documents[self.path]
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    with HTTPServer(('127.0.0.1', args.port), Handler) as server:
        base = 'http://127.0.0.1:' + str(server.server_port)
        server.documents = documents(base, package)
        print('Local Apps2Samsung test source: ' + base + '/feed.json', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
