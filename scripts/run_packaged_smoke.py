"""Run a deterministic smoke test against a packaged Qimchi executable."""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _print_log(home: Path) -> None:
    log_path = home / "logs" / "qimchi_debug.log"
    if log_path.exists():
        print("--- packaged Qimchi log ---")
        print(log_path.read_text(encoding="utf-8", errors="replace"))


def run_smoke(executable: Path, mode: str, timeout: int) -> None:
    executable = executable.resolve()
    if not executable.is_file():
        raise FileNotFoundError(f"Packaged executable not found: {executable}")

    with tempfile.TemporaryDirectory(prefix="qimchi-packaged-smoke-") as temp:
        smoke_root = Path(temp)
        home = smoke_root / "home"
        downloads = smoke_root / "downloads"
        env = os.environ.copy()
        env.update(
            {
                "QIMCHI_HOME": str(home),
                "QIMCHI_DOWNLOAD_DIR": str(downloads),
                "QIMCHI_PORT": str(_free_port()),
                "ENABLE_KALEIDO_WARMUP": "0",
                "APPIMAGE_EXTRACT_AND_RUN": "1",
            }
        )
        env["QIMCHI_NATIVE_SMOKE" if mode == "native" else "QIMCHI_HEADLESS_SMOKE"] = (
            "1"
        )

        print(f"Running {mode} packaged smoke: {executable}")
        command = (
            [sys.executable, str(executable)]
            if executable.suffix == ".py"
            else [str(executable)]
        )
        try:
            completed = subprocess.run(
                command,
                env=env,
                check=False,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            _print_log(home)
            raise RuntimeError(
                f"Packaged {mode} smoke timed out after {timeout}s"
            ) from None

        _print_log(home)
        if completed.returncode != 0:
            raise RuntimeError(
                f"Packaged {mode} smoke failed with exit code {completed.returncode}"
            )

        archives = list(downloads.glob("smoke-measurement*.zip"))
        if len(archives) != 1:
            raise RuntimeError(f"Expected one smoke download, found: {archives}")
        with zipfile.ZipFile(archives[0]) as archive:
            if "smoke-measurement.nc" not in archive.namelist():
                raise RuntimeError(f"Unexpected archive members: {archive.namelist()}")
        print(f"PASS: {mode} packaged smoke created {archives[0].name}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    parser.add_argument("--mode", choices=("headless", "native"), default="headless")
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    try:
        run_smoke(args.executable, args.mode, args.timeout)
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
