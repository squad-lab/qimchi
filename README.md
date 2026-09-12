# <img src="./frontend/public/qimchi-logo.png" alt="Qimchi Logo" width="25" style="vertical-align: middle;"/> Qimchi v0.7.0

Plotly based data visualization tool for `xarray` data. Optimized to work with the optional [`qanary`](https://gitlab.com/squad-lab/qanary) package. Qimchi supports any dataset format convertible to `xarray` (see [Supported Dataset Types](#supported-dataset-types) below). Documentation for handling these files can be found [here](https://xarray.pydata.org/en/stable/io.html).

This repository contains a unified FastAPI application that serves a React-based frontend for the Qimchi plotter.

## What's new in 0.7.0

> [!TIP]
> 🖥️ **Desktop app:** a self-contained build that runs Qimchi in a native window, with no separate Git/Python/Node install. Per-OS installers -- Windows (`qimchi-setup.exe`), Linux AppImage, macOS DMG -- on the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases). The app checks for updates on startup and offers a one-click "Update now".

- **Library:** heart, trash and tag your measurements. Marks are saved locally and shown in the Explorer, with filters for hearted-only, hiding trash, and tags. Select several measurements and apply any of them at once.
- **Tags work like labels** -- a measurement can carry several. Filter from the searchable Tags dropdown, or type `#tag` (or `#"two words"`) in the Explorer search alongside an ordinary name search.
- **Marks follow a measurement** even if you rename or move its file. Qimchi identifies it by its qanary ID, a QCoDeS run GUID, or -- failing both -- a signature derived from the data itself. Nothing is written next to your files.
- **Notes** live in the library instead of `.md` sidecars, so QCoDeS runs and artefacts can have notes too. Existing sidecar notes are imported automatically, and the runs of a QCoDeS database share one overall view.
- **Dark mode**, with a toggle in the sidebar rail. Follows your system preference by default; plots, metadata and filters all follow the theme.
- **Plot pinning:** hold a plot on its measurement while Next/Prev moves the others, to compare two datasets side by side. Adding a measurement also reproduces your custom plots for it, with the same variables and filters.
- **UI improvements:** Explorer, Metadata, Notes and Live Measurements open one at a time from an icon rail, with `Alt+1`--`Alt+4` to switch between them. The Explorer can take over the whole window with `Shift+F`, and the Basket, Composer and Viewer get control ribbons of their own. The Explorer has also been rewritten to be faster and more responsive.
- **Searchable help** (fuzzy, across every section) and **app zoom** from the rail, both remembered between sessions.
- **QCoDeS and Quantify metadata** is shown as the run actually carries it, instead of the four qanary sections reading "N/A".

Everything in this release is listed in the [changelog on `preview`](https://gitlab.com/squad-lab/qimchi/-/blob/preview/CHANGELOG.md).

<!-- TODO: -->
<!-- Full API documentation and more can be found [here](https://qimchi.squad-lab.org) -->

## Table of Contents

- [ Qimchi v0.7.0](#-qimchi-v070)
  - [What's new in 0.7.0](#whats-new-in-070)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
    - [Windows](#windows)
    - [Linux/macOS](#linuxmacos)
    - [Docker Installation](#docker-installation)
      - [Prerequisites](#prerequisites)
      - [Basic Setup](#basic-setup)
      - [Advanced Setup (with HTTPS)](#advanced-setup-with-https)
    - [Expert Installation](#expert-installation)
      - [Windows](#windows-1)
      - [Linux/macOS](#linuxmacos-1)
  - [Environment Variables](#environment-variables)
  - [Supported Dataset Types](#supported-dataset-types)
  - [Measurements](#measurements)
  - [Authors](#authors)

## Installation

> [!TIP]
> **Download the latest build from the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases):** `qimchi-setup.exe` (Windows), `qimchi.dmg` (macOS) or `qimchi-x86_64.AppImage` (Linux).

The desktop app is the recommended install on all three platforms. Qimchi can also be built from source and run as a local server, deployed with Docker, or installed manually -- choose the method that best suits your use case.

### Windows

> [!tip]
> Easiest method for Windows users.

Download `qimchi-setup.exe` from the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases) and run it. It installs per user, so no administrator rights are needed, and it creates a Start Menu entry plus an optional desktop shortcut. Qimchi runs as a desktop app and bundles everything it needs -- no Git, Python or Node.js required.

Windows SmartScreen will warn that the publisher is unrecognised: click **More info**, then **Run anyway**. Qimchi is not code-signed yet, so this appears once per version you install.

Requires Windows 11 (x64) with the Edge WebView2 runtime (preinstalled).

`qanary` is not installed with Qimchi. If you need it, install it from its [repository](https://gitlab.com/squad-lab/qanary).

### Linux/macOS

> [!tip]
> Easiest method: the desktop app, from the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases).

**macOS** -- download `qimchi.dmg`, open it, and drag Qimchi to Applications. Double-click Qimchi there; macOS reports that the app is from an unidentified developer. Open **System Settings -> Privacy and Security**, scroll down to **Security**, click **Open Anyway** next to Qimchi, confirm, and enter your account credentials. Qimchi is not notarized yet, so this happens once per version you install. Requires Apple Silicon.

**Linux** -- download `qimchi-x86_64.AppImage`, then:

```bash
chmod +x qimchi-x86_64.AppImage
./qimchi-x86_64.AppImage
```

Requires the WebKit2GTK runtime (`sudo apt-get install libwebkit2gtk-4.0-37` on Ubuntu/Debian, `webkit2gtk4.0` on Fedora, `webkit2gtk` on Arch).

Alternatively, to build from source and run Qimchi as a local server instead:

```bash
bash -c "$(curl -fsSL https://gitlab.com/squad-lab/qimchi/-/raw/main/qimchi-install.sh)"
```

After installation, either restart your shell, or run:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then start Qimchi with `qimchi`; the web interface will be available at http://localhost:8001.

`qanary` is not installed with Qimchi. If you need it, install it from its [repository](https://gitlab.com/squad-lab/qanary).

### Docker Installation

Docker provides a containerized environment that isolates Qimchi from your local system, ensuring a smooth setup with all required dependencies, and avoiding potential conflicts with other software.

#### Prerequisites

First, ensure Docker is installed on your system. You can find installation instructions on the [official Docker website](https://docs.docker.com/get-docker/).

> [!important]
> Docker might require administrative privileges to be installed and run.

#### Basic Setup

To get started quickly without domain configuration, use the following `compose.yaml` file:

```yaml
networks:
  squad:
    driver: bridge

services:
  qimchi:
    image: registry.gitlab.com/squad-lab/qimchi:latest
    container_name: qimchi
    restart: unless-stopped
    ports:
      # The container serves on 8001; the left-hand side is the port you visit.
      - 80:8001
    volumes:
      - ./qimchi/data:/root/.qimchi/
      - /your/data/:/data/
    networks:
      - squad
    environment:
      - EXPORT_MAX_WORKERS=4
      - QIMCHI_MAX_DEPTH=6
      - SERVE_STATIC_FILES=true
```

Environment variables can be provided via a `.env` file. Please see [Environment Variables](#environment-variables) for details.

This setup exposes Qimchi on `localhost:80`.

**Start the service:**
```bash
docker compose pull
docker compose up -d
```

**Access:**
- **Application:** http://localhost:80
- **API Documentation:** http://localhost:80/docs  
- **Health Check:** http://localhost:80/health

#### Advanced Setup (with HTTPS)

For production deployments with HTTPS and domain support (e.g., via Cloudflare), use the following `compose.yaml` configuration:

```yaml
networks:
  squad:
    driver: bridge

services:
  nginx:
    image: nginx:latest
    container_name: nginx
    profiles: ["webdev"]
    user: root
    restart: unless-stopped
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d
      - ./nginx/letsencrypt:/etc/letsencrypt
      - ./nginx/html:/usr/share/nginx/html
    ports:
      - 80:80
      - 443:443
    networks:
      - squad

  certbot:
    image: certbot/dns-cloudflare
    container_name: certbot
    profiles: ["webdev"]
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./nginx/letsencrypt:/etc/letsencrypt
      - ./nginx/html:/usr/share/nginx/html
      - ./nginx/certbot-secrets:/certbot-secrets
    entrypoint: >
      /bin/sh -c '
      echo "dns_cloudflare_api_token=$$CLOUDFLARE_API_TOKEN" > /certbot-secrets/cloudflare.ini;
      chmod 600 /certbot-secrets/cloudflare.ini;
      trap exit TERM;
      while :; do certbot renew; sleep 12h & wait $${!}; done;
      '
    networks:
      - squad

  qimchi:
    image: registry.gitlab.com/squad-lab/qimchi:latest
    container_name: qimchi
    profiles: ["webdev"]
    restart: unless-stopped
    volumes:
      - ./qimchi/data:/root/.qimchi/
      - /your/data/:/data/
    networks:
      - squad
```

For the `.env` file, please refer to the [Environment Variables](#environment-variables) section. Additionally, you need to set the `CLOUDFLARE_API_TOKEN` variable for Certbot to manage TLS certificates.

Example NGINX configuration (`./nginx/conf.d/default.conf`):

```nginx
server {
    listen 80;
    server_name plot.domain.org;

    # Redirect all HTTP traffic to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name plot.domain.org;

    ssl_certificate /etc/letsencrypt/live/domain.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/domain.org/privkey.pem;

    location / {
        proxy_pass http://qimchi:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

This setup uses Certbot with Cloudflare for automatic TLS certificate renewal. Be sure to replace `domain.org` and `plot.domain.org` with your actual domain names.

> [!note]
> The `CLOUDFLARE_API_TOKEN` environment variable is used to authenticate with Cloudflare's DNS API for domain verification.

### Expert Installation

> [!warning]
> This method is for advanced users who want full control over the installation process.

For manual installation with full control over the setup process, follow these steps:

#### Windows

1. **Clone the repository:**
   ```powershell
   git clone https://gitlab.com/squad-lab/qimchi.git
   cd qimchi
   ```

2. **Install dependencies using [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):**
   ```powershell
   # Install Git (if not already installed)
   winget install Git.Git
   
   # Install uv (Ultra-fast Python package manager)
   powershell -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
   
   # Install Node.js
   winget install OpenJS.NodeJS
   
   # Install fd (REQUIRED: the Explorer's directory tree is built with it)
   winget install sharkdp.fd
   ```

   > [!tip]
   > **Restart your PowerShell terminal to ensure all `PATH` changes take effect**.

   > [!important]
   > The frontend build needs Node `^20.19` or `>=22.12`. On Node 21.x npm skips a
   > native dependency and the build then fails.

3. **Set up Python virtual environment:**
   ```powershell
   cd ..
   uv venv --python 3.13 --seed --clear
   .\.venv\Scripts\activate
   ```

4. **Install backend dependencies:**
   ```powershell
   cd qimchi\backend
   # The datasets extra carries the readers for NetCDF, HDF5, CSV/TXT and
   # zarr v2. Without it those formats fail to open.
   uv pip install ".[datasets]"
   ```

5. **Provide a browser for image export:**
   ```powershell
   # Kaleido v1 does not bundle Chrome. Skip this if Chrome or Chromium is
   # already installed; PNG/SVG export needs one of them.
   echo y | plotly_get_chrome
   ```

6. **Build the frontend:**
   ```powershell
   cd ..\frontend
   npm install
   npm run build
   ```

7. **Start the server:**
   ```powershell
   cd ..\backend
   $env:PYTHONPATH="$PWD"
   $env:SERVE_STATIC_FILES="true"
   uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1 --log-level info --ws-max-size 200000000 --ws-ping-interval 20 --ws-ping-timeout 20
   ```

#### Linux/macOS

1. **Clone the repository:**
   ```bash
   git clone https://gitlab.com/squad-lab/qimchi.git
   cd qimchi
   ```

2. **Install dependencies:**
   
   **Ubuntu/Debian:**
   ```bash
   # Install Git (if not already installed)
   sudo apt update
   sudo apt install git
   
   # Install uv (Ultra-fast Python package manager)
   curl -LsSf https://astral.sh/uv/install.sh | sh
   
   # Install Node.js via nvm (Node Version Manager)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
   # Reload shell configuration
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   # Install Node.js LTS (needs ^20.19 or >=22.12; Node 21.x cannot build the frontend)
   nvm install --lts
   nvm use --lts
   
   # Install fd (REQUIRED: the Explorer's directory tree is built with it)
   sudo apt install fd-find
   ```
   
   **macOS (using Homebrew):**
   ```bash
   # Install Homebrew if not already installed
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   
   # Install dependencies
   brew install git
   brew install uv
   brew install fd
   
   # Install Node.js via nvm (Node Version Manager)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
   # Reload shell configuration
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   # Install Node.js LTS (needs ^20.19 or >=22.12; Node 21.x cannot build the frontend)
   nvm install --lts
   nvm use --lts
   ```

3. **Set up Python virtual environment:**
   ```bash
   cd ..
   uv venv --python 3.13 --seed --clear
   source .venv/bin/activate
   ```

4. **Install backend dependencies:**
   ```bash
   cd qimchi/backend
   # The datasets extra carries the readers for NetCDF, HDF5, CSV/TXT and
   # zarr v2. Without it those formats fail to open.
   uv pip install ".[datasets]"
   ```

5. **Provide a browser for image export:**
   ```bash
   # Kaleido v1 does not bundle Chrome. Skip this if Chrome or Chromium is
   # already installed; PNG/SVG export needs one of them.
   echo "y" | plotly_get_chrome
   ```

6. **Build the frontend:**
   ```bash
   cd ../frontend
   npm install
   npm run build
   ```

7. **Start the server:**
   ```bash
   cd ../backend
   export PYTHONPATH="$PWD"
   export SERVE_STATIC_FILES="true"
   # Use --host 0.0.0.0 instead to reach it from another machine on the network.
   uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1 --log-level info --ws-max-size 200000000 --ws-ping-interval 20 --ws-ping-timeout 20
   ```

**Access the application:**
- **Application:** http://localhost:8001
- **API Documentation:** http://localhost:8001/docs  
- **Health Check:** http://localhost:8001/health

## Environment Variables

Set these in `backend/.env` or via Docker environment:

- `EXPORT_MAX_WORKERS`: Max number of worker processes spawned for export image rendering. Set to an integer or leave blank to auto-detect (defaults to min(4, cpu_count))
- `EXPORT_TIMING_LOG`: Enable more verbose export timing logs (default: false)
- `ENABLE_KALEIDO_WARMUP`: Warm the export workers on startup (default: true). Set to `0` to opt out
- `ENABLE_KALEIDO_SYNC_SERVER`: Manage the Kaleido sync server lifecycle, a performance workaround (default: true)
- `QIMCHI_MAX_DEPTH`: Max depth for directory traversal (default: 6)
- `SERVE_STATIC_FILES`: Serve static files via FastAPI/uvicorn (default: true). Set to false when a separate web server serves the built frontend
- `QIMCHI_HOME`: Application home holding the library database, logs and caches (default: `~/.qimchi`)
- `QIMCHI_DB_PATH`: Exact path to the library database, for a mounted volume (default: `<QIMCHI_HOME>/qimchi.db`)
- `QIMCHI_LOG_PATH`: Exact path to the application log
- `QIMCHI_NOTES_MD_EXPORT`: Also mirror notes to `.md` files next to the measurements (default: on)

> [!note]
> Qimchi runs as a single uvicorn worker.

Example `backend/.env`:
```bash
# Max number of worker processes spawned for export image rendering
# (default: min(4, cpu_count))
EXPORT_MAX_WORKERS=4

# Optional: enable more verbose export timing logs
EXPORT_TIMING_LOG=true

# Warm the export workers on startup (default: true). Set to 0 to opt out.
ENABLE_KALEIDO_WARMUP=1

# Max depth for directory traversal (default: 6)
QIMCHI_MAX_DEPTH=6

# Serve static files via FastAPI/uvicorn (default: true)
SERVE_STATIC_FILES=true

# Optional: application home for the library database, logs and caches
# QIMCHI_HOME=/data/qimchi
```

## Supported Dataset Types
Qimchi's backend supports loading datasets in any format that can be converted to an `xarray` DataArray or Dataset. This includes:
- Zarr (v2 and v3)
- QCoDeS databases (via `load_by_id()`)
- Quantify databases
- NetCDF
- HDF5
- Flat files (CSV, TXT, DAT) - requires `polars` dependency
- `xarray` DataTrees (hierarchical datasets)
- SQLite-backed containers with `xarray`-compatible structure
- Custom formats convertible to `xarray` via user-defined loaders (see [Custom Dataset Support](https://qimchi.squad-lab.org/docs/custom_datasets.md))

## Measurements
Measurement examples referencing `qanary` can be found in its own repository. Refer to [its repository](https://gitlab.com/squad-lab/qanary) for more details. If you need `qanary`, the project must be installed manually; it is no longer installed automatically by the Qimchi installer.


## Authors

- Spandan Anupam: [s.anupam@fz-juelich.de](mailto:s.anupam@fz-juelich.de)
- Jyotirmaya Shivottam: [shivottam@proton.me](mailto:shivottam@proton.me)
