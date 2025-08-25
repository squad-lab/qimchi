#!/bin/sh
set -e

# Start gunicorn (Uvicorn workers) in background
cd /app/backend
gunicorn -c /app/gunicorn_conf.py main:app &

# Emit runtime config for the frontend (optional). This writes a small JS
# file that the frontend will load at boot to set window.__QIMCHI_RUNTIME__.
# The frontend will prefer explicit PROD_BACKEND_URL/PROD_BACKEND_WS if set,
# otherwise it may use PROD_BACKEND_HOST/PROD_BACKEND_PORT.
RC=/usr/share/nginx/html/runtime-config.js
# Build a JS object where unset env vars are written as null so
# the frontend's nullish coalescing (??) falls back correctly.
entries=""
add_entry() {
	key="$1"
	val="$2"
	if [ -n "$val" ]; then
		entry="  $key: \"$val\""
	else
		entry="  $key: null"
	fi
	if [ -z "$entries" ]; then
		entries="$entry"
	else
		entries="$entries,\n$entry"
	fi
}

add_entry PROD_BACKEND_URL "${PROD_BACKEND_URL:-}"
add_entry PROD_BACKEND_WS "${PROD_BACKEND_WS:-}"
add_entry PROD_BACKEND_HOST "${PROD_BACKEND_HOST:-}"
add_entry PROD_BACKEND_PORT "${PROD_BACKEND_PORT:-}"

printf 'window.__QIMCHI_RUNTIME__ = {\n%s\n};\n' "$entries" > "$RC"

# Start nginx in foreground
nginx -g 'daemon off;'
