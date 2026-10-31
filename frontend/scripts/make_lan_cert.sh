#!/bin/sh
# Makes a self-signed certificate for this computer's local-network address, so a second computer can open the dev
# server over https and use its microphone. Usage: scripts/make_lan_cert.sh [ip]   (default: this Mac's Wi-Fi address)
set -e
cd "$(dirname "$0")/.."
IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | cut -d' ' -f1)}"
[ -n "$IP" ] || { echo "Could not find this computer's local address; pass it as an argument." >&2; exit 1; }
mkdir -p .certs
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout .certs/lan.key -out .certs/lan.crt \
  -subj "/CN=$IP" -addext "subjectAltName=IP:$IP,IP:127.0.0.1,DNS:localhost" 2>/dev/null
echo "Certificate for $IP written to frontend/.certs (valid 30 days)."
