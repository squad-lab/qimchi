import multiprocessing
import os

bind = '0.0.0.0:8000'

# Allow overriding via environment variable; ensure minimum of 8 workers
try:
	env_workers = int(os.environ.get("GUNICORN_WORKERS", "0"))
except Exception:
	env_workers = 0

default_workers = max(2, multiprocessing.cpu_count() // 2)
workers = max(8, env_workers if env_workers > 0 else default_workers)
worker_class = 'uvicorn.workers.UvicornWorker'
timeout = 120
