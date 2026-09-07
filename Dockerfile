FROM node:22.12.0-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
COPY frontend/tsconfig*.json ./
COPY frontend/vite.config.ts ./
COPY frontend/postcss.config.js ./
COPY frontend/index.html ./
COPY frontend/public/ ./public/
COPY frontend/src/ ./src/

RUN npm ci \
    && npm run build


FROM python:3.13-slim AS final

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    fd-find \
    nginx \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml backend/uv.lock /app/

RUN python -m pip install --no-cache-dir -U pip setuptools wheel \
    && pip install --no-cache-dir uv \
    && uv sync --locked --no-dev --extra datasets --no-install-project \
    && echo "y" | uv run --no-sync plotly_get_chrome

COPY backend/api/ /app/api/
COPY backend/main.py /app/
COPY backend/migrations/ /app/migrations/

# Install the local project after its sources are present. Dependencies were
# cached in the preceding layer; --locked keeps the image reproducible.
RUN uv sync --locked --no-dev --extra datasets

COPY --from=frontend-builder /frontend/dist/ /app/frontend/dist/

COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/ \
    && mkdir -p /var/log/supervisor

EXPOSE 8001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
