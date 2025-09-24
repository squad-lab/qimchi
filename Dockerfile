FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Install OS packages + fd-find + nginx
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    fd-find \
    nginx \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js for building the frontend
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs

# Install Python dependencies first (for better Docker layer caching)
COPY backend/pyproject.toml backend/requirements.txt /app/
RUN python -m pip install --no-cache-dir -U pip setuptools wheel \
    && pip install --no-cache-dir uv \
    && (uv sync --no-dev || (if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi)) \
    && echo "y" | uv run plotly_get_chrome

# Copy and build the React frontend
COPY frontend/package*.json /tmp/frontend/
COPY frontend/tsconfig*.json /tmp/frontend/
COPY frontend/vite.config.ts /tmp/frontend/
COPY frontend/postcss.config.js /tmp/frontend/
COPY frontend/tailwind.config.js /tmp/frontend/
COPY frontend/index.html /tmp/frontend/
COPY frontend/public/ /tmp/frontend/public/
COPY frontend/src/ /tmp/frontend/src/

# Build the frontend & copy the built files to /app/frontend
RUN cd /tmp/frontend \
    && npm ci \
    && npm run build \
    && mkdir -p /app/frontend \
    && cp -r dist /app/frontend/ \
    && rm -rf /tmp/frontend

# Copy backend application code
COPY backend/api/ /app/api/
COPY backend/main.py /app/

# Copy nginx and supervisor configurations
COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Remove default nginx config and create log directories
RUN rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/ \
    && mkdir -p /var/log/supervisor

# Clean up Node.js to reduce image size
RUN apt-get remove -y nodejs \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Expose the port nginx will listen on
EXPOSE 8001

# Use supervisor to run both nginx and FastAPI
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
