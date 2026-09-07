# <img src="./frontend/public/qimchi-logo.png" alt="Qimchi Logo" width="25" style="vertical-align: middle;"/> Qimchi v0.7.0

Plotly based data visualization tool for `xarray` data. Optimized to work with the optional [`qanary`](https://gitlab.com/squad-lab/qanary) package (the installer no longer installs `qanary` by default). Qimchi supports any dataset format convertible to `xarray` (see [Supported Dataset Types](#supported-dataset-types) below). Documentation for handling these files can be found [here](https://xarray.pydata.org/en/stable/io.html).

This repository contains a unified FastAPI application that serves a React-based frontend for the Qimchi plotter.

## v0.7.x Highlights

> [!TIP]
> 🖥️ **Desktop app:** a self-contained build that runs Qimchi in a native window, with no separate Git/Python/Node install. Per-OS installers -- Windows (`qimchi-setup.exe`), Linux AppImage, macOS DMG -- on the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases). The app checks for updates on startup and offers a one-click "Update now".

- **Library:** heart, trash and tag your measurements. Marks are saved locally and shown in the Explorer, with filters for hearted-only, hiding trash, and tags. Select several measurements and apply any of them at once.
- **Tags work like labels** -- a measurement can carry several. Filter from the searchable Tags dropdown, or type `#tag` (or `#"two words"`) in the Explorer search alongside an ordinary name search.
- **Marks follow a measurement** even if you rename or move its file. Qimchi identifies it by its qanary ID, a QCoDeS run GUID, or -- failing both -- a signature derived from the data itself. Nothing is written next to your files.
- **Notes** live in the library instead of `.md` sidecars, so QCoDeS runs and artefacts can have notes too. Existing sidecar notes are imported automatically.
- **Dark mode**, with a toggle in the footer. Follows your system preference by default; plots, metadata and filters all follow the theme.
- **Plot pinning:** hold a plot on its measurement while Next/Prev moves the others, to compare two datasets side by side. Adding a measurement also reproduces your custom plots for it, with the same variables and filters.

## Earlier highlights (v0.5.x -- v0.6.x)

- **Load any `xarray`-convertible dataset:** one loader handles Zarr (v2 and v3), `xarray` DataTrees, NetCDF/HDF5, QCoDeS DBs, flat CSV/TXT and SQLite-backed containers. Custom formats via loader templates -- see [docs/custom_datasets.md](docs/custom_datasets.md).
- **Create LineCuts:** interactive horizontal/vertical slicing with live preview.
- **Perform Background correction:** LinePlots (constant, linear) and HeatMaps (constant, row/col mean, plane).
- **Explorer and Viewer:** path history, dataset cycling across formats, robust filter handling, and a persistent layout (sidebar width and section heights survive reloads).
- **Keyboard shortcuts** throughout -- Filters, Appearance, Maximized view, Notes, Export -- with a Help & Tips modal documenting each component.
- Plot titles name the variables (`Y vs X`) rather than "Line Plot"/"Heat Map"; the Basket shows newest first and reveals overflowing variable lists on hover.


<!-- Full API documentation and more can be found [here](https://qimchi.squad-lab.org) -->

## Table of Contents

- [ Qimchi v0.7.0](#-qimchi-v070)
  - [v0.7.x Highlights](#v07x-highlights)
  - [Earlier highlights (v0.5.x -- v0.6.x)](#earlier-highlights-v05x----v06x)
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

Qimchi supports multiple installation methods, including executable scripts, Docker, and expert manual installation. Choose the method that best suits your use case.

### Windows

> [!tip]
> Easiest method for Windows users.

Download the latest `qimchi.exe` from the [Releases page](https://gitlab.com/squad-lab/qimchi/-/releases) and run it. The executable will:
- Automatically install all required dependencies (Git, Python, Node.js, fd-find)
- Set up the application in `%USERPROFILE%\.qimchi`
- Clone and configure Qimchi (Qanary is optional and not installed by the Windows installer)
- Build the frontend and start the server
- Open the web interface in your browser

Simply double-click `qimchi.exe` and follow the prompts. The web interface will be available at http://localhost:8001.

Note: The Windows installer no longer clones or installs `qanary` (formerly, `qcutils`) by default. If you need `qanary`, please install it manually from its [repository](https://gitlab.com/squad-lab/qanary).

### Linux/macOS

> [!tip]
> Recommended for Linux and macOS users.

Run the following command in your terminal:

```bash
bash -c "$(curl -fsSL https://gitlab.com/squad-lab/qimchi/-/raw/main/qimchi-install.sh)"
```

After installation, either restart your shell, or run:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

Note: The Linux/macOS installer (`qimchi-install.sh`) no longer clones or installs `qanary` (formerly, `qcutils`) by default. If you need `qanary`, please install it manually from its [repository](https://gitlab.com/squad-lab/qanary).

Then simply start qimchi with `qimchi`. The web interface will be available at http://localhost:8001.

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
    profiles: ["webdev"]
    restart: unless-stopped
    ports:
      - 80:80
    volumes:
      - ./qimchi/data:/root/.qimchi/
      - /your/data/:/data/
    networks:
      - squad
    environment:
      - NUM_WORKERS=8
      - EXPORT_MAX_WORKERS=4
      - QIMCHI_MAX_DEPTH=6
      - SERVE_STATIC_FILES=true
```

Environment variables can be provided via a `.env` file. Please see [Environment Variables](#environment-variables) for details.

This setup exposes Qimchi on `localhost:80`.

**Start the service:**
```bash
docker compose up --build -d
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
    server_name example.domain.org;

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
        proxy_pass http://qimchi:80;
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
   
   # Install fd-find (optional, for better directory tree performance)
   winget install sharkdp.fd
   ```

   > [!tip]
   > **Restart your PowerShell terminal to ensure all `PATH` changes take effect**.

3. **Set up Python virtual environment:**
   ```powershell
   cd ..
   uv venv --python 3.13 --seed --clear
   .\.venv\Scripts\activate
   ```

4. **Install backend dependencies:**
   ```powershell
   cd qimchi\backend
   uv pip install .
   ```

5. **Install Plotly Chrome support:**
   ```powershell
   echo y | python -c "import plotly; plotly.io.kaleido.scope.chromium.config.set_executable('chrome')"
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
   # Install latest Node.js LTS version
   nvm install --lts
   nvm use --lts
   
   # Install fd-find (optional, for better performance)
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
   # Install latest Node.js LTS version
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
   uv pip install .
   ```

5. **Install Plotly Chrome support:**
   ```bash
   echo "y" | python -c "import plotly; plotly.io.kaleido.scope.chromium.config.set_executable('chrome')"
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
   uvicorn main:app --host 0.0.0.0 --port 8001 --workers 1 --log-level info --ws-max-size 200000000 --ws-ping-interval 20 --ws-ping-timeout 20
   ```

**Access the application:**
- **Application:** http://localhost:8001
- **API Documentation:** http://localhost:8001/docs  
- **Health Check:** http://localhost:8001/health

## Environment Variables

Set these in `backend/.env` or via Docker environment:

- `NUM_WORKERS`: Number of uvicorn worker processes to spawn (default: 8)
- `EXPORT_MAX_WORKERS`: Max number of worker processes spawned for export image rendering per uvicorn worker. Set to an integer or leave blank to auto-detect (defaults to min(8, cpu_count))
- `EXPORT_TIMING_LOG`: Enable more verbose export timing logs (default: false)
- `ENABLE_KALEIDO_WARMUP`: Enable Plotly Kaleido warm-up on startup. Set to `1`, `true`, or `yes` to enable (default: 0/off)
- `QIMCHI_MAX_DEPTH`: Max depth for directory traversal (default: 6)
- `SERVE_STATIC_FILES`: Serve static files via FastAPI/uvicorn (default: true)

Example `backend/.env`:
```bash
# Number of uvicorn worker processes to spawn (default: 8)
NUM_WORKERS=8

# Max number of worker processes spawned for export image rendering (default: 4)
EXPORT_MAX_WORKERS=4

# Optional: enable more verbose export timing logs
EXPORT_TIMING_LOG=true

# Enable Kaleido warm-up on startup (default: 0/off). Set to 1/true/yes to enable.
ENABLE_KALEIDO_WARMUP=1

# Max depth for directory traversal (default: 6)
QIMCHI_MAX_DEPTH=6

# Serve static files via FastAPI/uvicorn (default: true)
SERVE_STATIC_FILES=true
```

## Supported Dataset Types
Qimchi's backend supports loading datasets in any format that can be converted to an `xarray` DataArray or Dataset. This includes:
- Zarr (v2 and v3)
- NetCDF
- HDF5
- QCoDeS databases (via `load_by_id()`)
- Flat files (CSV, TXT, DAT) - requires `polars` dependency
- `xarray` DataTrees (hierarchical datasets)
- SQLite-backed containers with `xarray`-compatible structure
- Custom formats convertible to `xarray` via user-defined loaders (see [Custom Dataset Support](https://qimchi.squad-lab.org/docs/custom_datasets.md))

## Measurements
Measurement examples referencing `qanary` can be found in its own repository. Refer to [its repository](https://gitlab.com/squad-lab/qanary) for more details. If you need `qanary`, the project must be installed manually; it is no longer installed automatically by the Qimchi installer.


## Authors

- Spandan Anupam: [s.anupam@fz-juelich.de](mailto:s.anupam@fz-juelich.de)
- Jyotirmaya Shivottam: [shivottam@proton.me](mailto:shivottam@proton.me)
