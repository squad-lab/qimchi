#!/bin/sh
set -e

# Start gunicorn (Uvicorn workers) in background
cd /app/backend
gunicorn -c /app/gunicorn_conf.py main:app &

# Start nginx in foreground
nginx -g 'daemon off;'
