#!/usr/bin/env python3
"""Serve this folder over HTTPS with a self-signed certificate, and relay settings between pages.

Usage: python3 serve.py [port]    (default 8443)
The certificate and key live outside this folder so they are never served.

Besides the static files there is a small API, so the controls page (the main address) can drive a display
(display.html?output) that is running somewhere else, such as an OBS Browser Source:
  GET  /api/events   server-sent events: "state" (the settings) and "status" (what the output reports)
  GET  /api/state    the same, as JSON
  POST /api/state    merge changed settings (from the controls page, or the display filling in a gap)
  POST /api/status   the display reports what it is doing (about 8 times a second)
The settings are kept in ~/.config/music-graphic/state.json, so they survive a restart.
There is no login: anyone who can reach this port can change the settings.
"""
import functools
import http.server
import json
import os
import queue
import ssl
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.expanduser('~/.config/music-graphic')
# MUSIC_GRAPHIC_STATE can point the saved settings somewhere else, so a test server never touches the real ones.
STATE_FILE = os.environ.get('MUSIC_GRAPHIC_STATE') or os.path.join(CONFIG_DIR, 'state.json')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
MAX_BODY = 64 * 1024


def number(lo, hi):
    return lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi


def text(limit):
    return lambda v: isinstance(v, str) and 0 < len(v) <= limit


# The settings the controls may change, and what each may be. Anything else is ignored.
SETTINGS = {
    'visual': text(40),
    'bg': lambda v: v in ('black', 'green', 'transparent'),
    'speed': number(0.25, 3),
    'reverse': lambda v: isinstance(v, bool),
    'auto': lambda v: isinstance(v, bool),
    'autoEvery': lambda v: v in (4, 8, 16, 32, 64, 128),
    'sens': number(0, 100),
    'gate': number(0, 60),
    'device': text(400),
    'debug': lambda v: isinstance(v, bool),
}
# What the output page may report (the controls page shows these, as text only).
STATUS = {'listening', 'bpm', 'locked', 'level', 'levels', 'visual', 'device', 'devices', 'catalog', 'debug'}


class Relay:
    def __init__(self):
        self.lock = threading.Lock()
        self.clients = []
        self.settings = {}
        self.status = {}
        self.status_at = 0.0
        try:
            with open(STATE_FILE) as f:
                saved = json.load(f)
            self.settings = self.valid(saved.get('settings', {}))
            if isinstance(saved.get('catalog'), list):
                self.status['catalog'] = saved['catalog']
        except (OSError, ValueError, AttributeError):
            pass

    @staticmethod
    def valid(patch):
        return {k: v for k, v in patch.items() if k in SETTINGS and SETTINGS[k](v)}

    def save(self):
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            tmp = STATE_FILE + '.tmp'
            with open(tmp, 'w') as f:
                json.dump({'settings': self.settings, 'catalog': self.status.get('catalog', [])}, f)
            os.replace(tmp, STATE_FILE)
        except OSError:
            pass

    def update_settings(self, patch):
        patch = self.valid(patch)
        if not patch:
            return
        with self.lock:
            self.settings.update(patch)
            self.save()
            self.broadcast('state', self.settings)

    def update_status(self, patch):
        patch = {k: v for k, v in patch.items() if k in STATUS}
        with self.lock:
            catalog_changed = 'catalog' in patch and patch['catalog'] != self.status.get('catalog')
            self.status.update(patch)
            self.status_at = time.time()
            if catalog_changed:
                self.save()
            self.broadcast('status', {**patch, 'ageMs': 0})

    def snapshot_status(self):
        age = (time.time() - self.status_at) * 1000 if self.status_at else 1e9
        return {**self.status, 'ageMs': age}

    @staticmethod
    def message(event, data):
        return f'event: {event}\ndata: {json.dumps(data)}\n\n'.encode()

    def broadcast(self, event, data):
        msg = self.message(event, data)
        for q in self.clients:
            try:
                q.put_nowait(msg)
            except queue.Full:
                pass   # a stuck client just misses updates; it is dropped when its connection fails

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.lock:
            q.put(self.message('state', self.settings))
            q.put(self.message('status', self.snapshot_status()))
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)


relay = Relay()


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'   # keep connections open: the output page posts several times a second
    timeout = 120                   # drop idle connections (the event stream never reads, so it is unaffected)

    def setup(self):
        # Handshake here, on this connection's own thread, so a browser that connects and then stalls
        # cannot block the server from accepting anyone else.
        self.request.settimeout(10)
        self.request = TLS.wrap_socket(self.request, server_side=True)
        super().setup()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')   # always revalidate, so OBS never runs stale scripts
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/'):
            super().log_message(fmt, *args)

    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/events':
            self.serve_events()
        elif path == '/api/state':
            self.send_json({'settings': relay.settings, 'status': relay.snapshot_status()})
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split('?')[0]
        length = int(self.headers.get('Content-Length') or 0)
        if path not in ('/api/state', '/api/status'):
            self.close_connection = True
            return self.send_json({'error': 'not found'}, 404)
        if length > MAX_BODY:
            self.close_connection = True
            return self.send_json({'error': 'too large'}, 413)
        try:
            patch = json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(patch, dict):
                raise ValueError
        except ValueError:
            return self.send_json({'error': 'bad json'}, 400)
        (relay.update_settings if path == '/api/state' else relay.update_status)(patch)
        self.send_json({'ok': True})

    def serve_events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        self.request.settimeout(30)   # a write that stalls this long means the client has gone
        q = relay.subscribe()
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                except queue.Empty:
                    msg = b': keep-alive\n\n'
                self.wfile.write(msg)
                self.wfile.flush()
        except OSError:
            pass
        finally:
            relay.unsubscribe(q)


class Server(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # Browsers drop connections and reject the self-signed certificate all the time; that is not news.
        if not isinstance(sys.exc_info()[1], (OSError, ssl.SSLError)):
            super().handle_error(request, client_address)


TLS = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
TLS.load_cert_chain(os.path.join(CONFIG_DIR, 'cert.pem'), os.path.join(CONFIG_DIR, 'key.pem'))

server = Server(('0.0.0.0', PORT), functools.partial(Handler, directory=HERE))

print(f'Serving {HERE} on https://0.0.0.0:{PORT}', flush=True)
print('  controls:      /                       (has a button to open the display)', flush=True)
print('  display:       /display.html?output    (for a tab or an OBS Browser Source)', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
