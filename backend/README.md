## Setup instructions for the backend of the Qimchi React app

### Local development (no Docker)

1. **Install `uv`**  
   Follow instructions here: https://docs.astral.sh/uv/getting-started/installation/

2. **Install dependencies** (two ways):

   ```pwsh
   # Option A: Using `uv` to automatically set up a virtual environment and install dependencies
   uv sync

   # Option B: Manually create a virtual environment and install dependencies
   # python -m venv .venv
   # .\.venv\Scripts\Activate.ps1 # For PowerShell
   # source .venv/bin/activate # For bash
   # pip install -r requirements.txt
   ```

3. **Get Google Chrome as Kaleido requires it to export images**
   
   ```pwsh
   # Plotly's way to get Chrome for image export
   plotly_get_chrome
   ```

4. **Start the backend server**

   **Recommended (standard, with `uv` + Uvicorn):**
   ```pwsh
   uv run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 8
   ```

   **Alternative (FastAPI’s CLI wrapper for Uvicorn):**
   ```pwsh
   fastapi run .\main.py --workers 8 --host 0.0.0.0 --port 8000
   ```

   > 💡 The `fastapi run` command is simpler but has fewer options compared to `uvicorn`.

---

### Running with Docker

A `Dockerfile`, `docker-compose.yml`, and `docker-compose.override.yml` are provided.  
- **docker-compose.yml** → production-style, multi-worker serving  
- **docker-compose.override.yml** → development with hot reload  

---

**Production example:**
```pwsh
# Build & start (detached)
docker compose up --build -d
```

**Development example (hot reload):**
```pwsh
# Build & start with override for live code reload
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

---

**Environment variables:**

`ALLOWED_ORIGINS` can be set in the compose file or via environment variables.  
Example value:  
```
http://192.168.1.42:80,https://myapp.local
```

Example (PowerShell) — set for this run only:
```pwsh
# $env:ALLOWED_ORIGINS = "http://192.168.1.42:80,https://myapp.local" # For PowerShell
export ALLOWED_ORIGINS="http://192.168.1.42:80,https://myapp.local" # For bash
docker compose up --build -d
```
