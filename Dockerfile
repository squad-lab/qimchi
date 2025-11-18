FROM node:20-slim AS frontend-builder

WORKDIR /frontend

COPY frontend/package*.json ./
COPY frontend/tsconfig*.json ./
COPY frontend/vite.config.ts ./
COPY frontend/postcss.config.js ./
COPY frontend/tailwind.config.js ./
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

COPY backend/pyproject.toml backend/requirements.txt /app/

RUN python -m pip install --no-cache-dir -U pip setuptools wheel \
    && pip install --no-cache-dir uv \
    && (uv sync --no-dev || (if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi)) \
    && echo "y" | uv run plotly_get_chrome

COPY backend/api/ /app/api/
COPY backend/main.py /app/

COPY --from=frontend-builder /frontend/dist/ /app/frontend/dist/

COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/ \
    && mkdir -p /var/log/supervisor

EXPOSE 8001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]