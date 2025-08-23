# Qimchi Plotting and Visualization

This repository contains frontend and backend for the Qimchi plotting and visualization app.

Quick start with Docker Compose. NOTE: Edit the volume mapping in `docker-compose.yml`, as required.

```pwsh
# CHANGEME: Edit the volume mapping in `docker-compose.yml`, as required.

# Build and start both services
docker compose up --build -d

# Frontend: http://localhost:80
# Backend: http://localhost:8000
```

Notes

- The frontend is served by nginx in production and expects backend at http://0.0.0.0:8000 by default (the frontend `src/config.ts` file).
- The backend Dockerfile uses Python 3.13 (see `backend/Dockerfile`).
- For FastAPI deployment notes, see: https://fastapi.tiangolo.com/deployment/docker/
