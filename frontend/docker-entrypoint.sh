#!/bin/sh
# Entry point for nginx image to inject runtime config for the SPA.
# It writes /usr/share/nginx/html/runtime-config.js using env vars passed at `docker run` or compose up.

set -e

OUT=/usr/share/nginx/html/runtime-config.js

cat > "$OUT" <<EOF
// This file is generated at container start to expose runtime config to the SPA
window.__QIMCHI_RUNTIME__ = {
  PROD_BACKEND_URL: "${PROD_BACKEND_URL}",
  PROD_BACKEND_WS: "${PROD_BACKEND_WS}",
  PROD_BACKEND_HOST: "${PROD_BACKEND_HOST}",
  PROD_BACKEND_PORT: "${PROD_BACKEND_PORT}"
};
EOF

exec "$@"
