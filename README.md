# Qimchi Plotting and Visualization

This repository contains a unified FastAPI application that serves both the React frontend and backend API for the Qimchi plotter.

**Supported Platform:** Linux only (Windows is unsupported, except via WSL)

## Quick Start

### Local Development (Linux)

1. **Install dependencies:**
   ```bash
   cd backend
   uv sync  # Install Python dependencies
   
   # Install Chrome for Plotly Kaleido image exports (auto-answer yes)
   echo "y" | uv run plotly_get_chrome
   
   cd ../frontend
   npm install  # Install Node.js dependencies
   ```

2. **Build frontend:**
   ```bash
   cd frontend
   npm run build
   ```

3. **Start the unified server:**
   ```bash
   cd backend
   uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload
   ```

   **Application:** http://localhost:8001

### Docker (Linux)

**Production:**
```bash
# Build and start the unified service
docker compose up --build -d
```

**Development (with hot reload):**
```bash
# Build and start with development overrides
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

**Access:**
- **Application:** http://localhost:8001
- **API Documentation:** http://localhost:8001/docs  
- **Health Check:** http://localhost:8001/health

## Architecture

- **Unified Container:** Single Docker container serves both React SPA and API endpoints on port 8001
- **Port Layout:**
  - **External (host):** port 8001 → nginx reverse proxy
  - **Internal (container):** port 8000 → FastAPI server
- **Routing:** nginx handles `/*` proxy to FastAPI, serves static files directly
- **Frontend:** React Single Page Application (SPA) served from `/`
- **Static Assets:** React build assets served from `/assets/`

## Configuration

- **Platform:** Linux only (Ubuntu/Debian-based containers)
- **Backend:** Python 3.13, FastAPI with `uvicorn`
- **Frontend:** React with TypeScript, Vite build system
- **Dependencies:** 
  - `fd-find` for efficient directory operations (Linux package)
  - Chrome/Chromium via Kaleido for plot image exports
- **Environment:** Configure via `.env` file in backend directory

## Environment Variables

Set these in `backend/.env` or via Docker environment:

- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `ENABLE_KALEIDO_WARMUP`: Set to `1` to enable Plotly Kaleido warm-up on startup  
- `EXPORT_MAX_WORKERS`: Number of worker processes for image export (default: 4)

Example `backend/.env`:
```bash
EXPORT_MAX_WORKERS=4
EXPORT_TIMING_LOG=true
ENABLE_KALEIDO_WARMUP=0
```

## Single Container Architecture

The unified Dockerfile builds everything in one container with nginx + FastAPI:

1. **Base:** Ubuntu/Debian Linux with Python 3.13
2. **System packages:** `fd-find`, `curl`, `nginx`, `supervisor` 
3. **Node.js:** Temporarily installed to build React frontend
4. **Python deps:** Installed with `uv` for fast dependency resolution
5. **Frontend build:** React app built with Vite and copied to `/app/frontend/dist`
6. **Backend:** FastAPI code copied to `/app`
7. **Cleanup:** Node.js removed to minimize final image size
8. **Chrome installation:** `plotly_get_chrome` for Kaleido image exports
9. **Runtime:** 
   - **nginx** (external port 8001) → serves static files + proxies `/*` to FastAPI
   - **FastAPI** (internal port 8000) → handles API requests only
   - **supervisor** → manages both processes

## File Structure

```
├── Dockerfile                 # Single unified container build
├── docker-compose.yml         # Production container config  
├── docker-compose.override.yml # Development overrides
├── nginx.conf                 # nginx configuration (port 8001)
├── supervisord.conf           # Process manager config
├── backend/                   # FastAPI application
│   ├── main.py               # API server (internal port 8000)
│   ├── api/                  # API endpoints
│   └── .env                  # Environment configuration
└── frontend/                 # React application  
    ├── src/                  # React source code
    └── dist/                 # Built assets (served by nginx)
```
