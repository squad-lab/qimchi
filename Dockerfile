# Multi-stage Dockerfile
# Stage 1: build the frontend with Node
FROM node:24-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
COPY frontend/ ./
RUN npm ci --prefer-offline --no-audit --progress=false || npm install
RUN npm run build

# Stage 2: runtime image with Python + nginx
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# Install system packages (nginx + small build tools). Keep layer small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      nginx \
      build-essential \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Remove default nginx site(s) to avoid duplicate default_server errors
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default || true

# Copy and install Python requirements
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Run plotly_get_chrome for kaleido (plotly static image export) non-interactively
RUN yes | plotly_get_chrome

# Copy backend application code
COPY backend /app/backend

# Copy built frontend from the builder stage into nginx html dir
COPY --from=frontend-builder /frontend/dist /usr/share/nginx/html

# Nginx config, start script and gunicorn config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/start.sh /start.sh
COPY docker/gunicorn_conf.py /app/gunicorn_conf.py
RUN chmod +x /start.sh

EXPOSE 80

CMD ["/start.sh"]
