#!/usr/bin/env python3
"""Serve this folder over HTTPS with a self-signed certificate.

Usage: python3 serve.py [port]    (default 8443)
The certificate and key live outside this folder so they are never served.
"""
import http.server
import os
import ssl
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.expanduser('~/.config/music-graphic')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443

handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=HERE, **kw)
server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(os.path.join(CERT_DIR, 'cert.pem'), os.path.join(CERT_DIR, 'key.pem'))
server.socket = ctx.wrap_socket(server.socket, server_side=True)

print(f'Serving {HERE} on https://0.0.0.0:{PORT}')
server.serve_forever()
