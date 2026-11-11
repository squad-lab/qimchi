"""Run slow backend work without blocking dataset loading or plotting."""

from __future__ import annotations

import asyncio
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, TypeVar

T = TypeVar("T")

# Downloads, exports, log bundles and live-registry probes run here, so the
# default pool stays free for loading datasets.
MAX_WORKERS = 4
_THREAD_PREFIX = "qimchi-background"

_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None
_pending = 0


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=MAX_WORKERS, thread_name_prefix=_THREAD_PREFIX
            )
        return _executor


def pending_jobs() -> int:
    """Return the number of jobs queued or running, other than the caller's own."""
    return _pending - threading.current_thread().name.startswith(_THREAD_PREFIX)


def _finished(_future: Future | None) -> None:
    global _pending
    with _lock:
        _pending -= 1


def submit(func: Callable[..., T], *args: Any, **kwargs: Any) -> Future[T]:
    """Start a job in the background pool without waiting for it."""
    global _pending
    with _lock:
        _pending += 1
    try:
        future = _get_executor().submit(func, *args, **kwargs)
    except BaseException:
        _finished(None)
        raise
    future.add_done_callback(_finished)
    return future


async def run(func: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run a job in the background pool and wait for its result."""
    return await asyncio.wrap_future(submit(func, *args, **kwargs))


def is_shut_down() -> bool:
    """Whether the pool was shut down, so a long job can stop early."""
    return _executor is None


def shutdown() -> None:
    """Drop queued jobs and let running ones finish on their own."""
    global _executor
    with _lock:
        executor, _executor = _executor, None
    if executor is not None:
        executor.shutdown(wait=False, cancel_futures=True)
