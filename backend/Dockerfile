FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Install OS packages you might need (curl for healthchecks, build tools if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python build/runtime dependencies
COPY pyproject.toml requirements.txt ./
# Install pip tooling and the `uv` CLI, then install project dependencies using uv (preferred).
# If `uv sync` fails for any reason, fall back to installing from requirements.txt if present.
RUN python -m pip install --no-cache-dir -U pip setuptools wheel \
    && pip install --no-cache-dir uv \
    && (uv sync --no-dev || (if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi))

# Copy application code
COPY . /app

# Expose the port FastAPI will listen on
EXPOSE 8000

# Default command: production server
CMD ["uv", "run", "uvicorn", "main:app", "--workers", "8", "--host", "0.0.0.0", "--port", "8000"]
