#!/usr/bin/env bash
set -e
set -o pipefail

# ----------------------------------------
# Configuration
# ----------------------------------------
QIMCHI_DIR="$HOME/.qimchi"
QCUTILS_DIR="$QIMCHI_DIR/qcutils"
VENV_DIR="$QIMCHI_DIR/.venv"
BIN_DIR="$HOME/.local/bin"
CLI_PATH="$BIN_DIR/qimchi"
QIMCHI_REPO="https://gitlab.com/squad-lab/qimchi.git"
QCUTILS_REPO="https://gitlab.com/squad-lab/qcutils.git"
DEFAULT_QIMCHI_BRANCH="main"
DEFAULT_QCUTILS_BRANCH="main"
PORT=8001

mkdir -p "$QIMCHI_DIR" "$BIN_DIR"

# ----------------------------------------
# Helper functions
# ----------------------------------------
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

install_fd() {
    if command_exists fd || command_exists fdfind; then
        echo "fd is already installed."
        return
    fi
    echo "fd-find not found. Installing..."
    if command_exists brew; then
        brew install fd
    elif command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y fd-find
        ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd" || true
    elif command_exists pacman; then
        sudo pacman -S --noconfirm fd
    else
        echo "Please install fd manually: https://github.com/sharkdp/fd"
        exit 1
    fi
    echo "fd installed successfully."
}

install_git() {
    if command_exists git; then
        echo "Git is already installed."
        return
    fi
    echo "Git not found. Installing..."
    if command_exists brew; then
        brew install git
    elif command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y git
    elif command_exists pacman; then
        sudo pacman -S --noconfirm git
    else
        echo "Please install Git manually."
        exit 1
    fi
}

install_node() {
    if command_exists node && command_exists npm; then
        echo "Node.js is already installed."
        return
    fi
    echo "Node.js not found. Installing..."
    if command_exists brew; then
        brew install node
    elif command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y nodejs npm
    elif command_exists pacman; then
        sudo pacman -S --noconfirm nodejs npm
    else
        echo "Please install Node.js manually."
        exit 1
    fi
}

install_uv() {
    if command_exists uv; then
        echo "uv is already installed."
        return
    fi
    echo "uv not found. Installing via Astral..."
    bash -c "$(curl -fsSL https://astral.sh/uv/install.sh)"
    if ! command_exists uv; then
        echo "uv installation failed. Please install manually."
        exit 1
    fi
}

# ----------------------------------------
# Step 1: Install dependencies
# ----------------------------------------
echo "============================================"
echo "Step 1: Installing dependencies"
echo "============================================"
install_git
install_uv
install_node
install_fd

# ----------------------------------------
# Helper: Pick branch from remote
# ----------------------------------------
pick_branch() {
    local repo_url=$1
    local default_branch=$2
    local repo_tmp_dir=$3
    local name=$4

    mkdir -p "$repo_tmp_dir"
    cd "$repo_tmp_dir"

    # Fetch branch list
    if [ ! -d "$repo_tmp_dir/.git" ]; then
        git init >/dev/null 2>&1
        git remote add origin "$repo_url"
    fi
    git fetch --all --tags >/dev/null 2>&1

    mapfile -t branches < <(git ls-remote --heads origin | awk '{print $2}' | sed 's|refs/heads/||')
    echo ""
    echo "Available $name branches:"
    local i=1
    for b in "${branches[@]}"; do
        echo "  [$i] $b"
        ((i++))
    done

    read -p "Pick a number for $name branch (default: $default_branch): " choice
    if [[ -z "$choice" ]]; then
        echo "$default_branch"
        rm -rf "$repo_tmp_dir"
        return
    fi

    if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#branches[@]}" ]; then
        echo "Invalid choice, using default branch $default_branch"
        rm -rf "$repo_tmp_dir"
        echo "$default_branch"
        return
    fi
    local selected_branch="${branches[$((choice-1))]}"
    rm -rf "$repo_tmp_dir"
    echo "$selected_branch"
}

# ----------------------------------------
# Step 2: Choose branches interactively
# ----------------------------------------
QIMCHI_BRANCH=$(pick_branch "$QIMCHI_REPO" "$DEFAULT_QIMCHI_BRANCH" "$QIMCHI_DIR/qimchi-tmp" "QIMCHI")
QCUTILS_BRANCH=$(pick_branch "$QCUTILS_REPO" "$DEFAULT_QCUTILS_BRANCH" "$QIMCHI_DIR/qcutils-tmp" "QCUtils")

# ----------------------------------------
# Step 3: Clone or update QIMCHI
# ----------------------------------------
echo "============================================"
echo "Step 3: Setting up QIMCHI (branch: $QIMCHI_BRANCH)"
echo "============================================"
cd "$QIMCHI_DIR"
if [ ! -d "$QIMCHI_DIR/qimchi" ]; then
    git clone --branch "$QIMCHI_BRANCH" "$QIMCHI_REPO" qimchi
else
    cd "$QIMCHI_DIR/qimchi"
    git fetch origin
    git checkout "$QIMCHI_BRANCH"
    git reset --hard origin/"$QIMCHI_BRANCH"
fi

# ----------------------------------------
# Step 4: Clone or update QCUtils
# ----------------------------------------
echo "============================================"
echo "Step 4: Setting up QCUtils (branch: $QCUTILS_BRANCH)"
echo "============================================"
cd "$QIMCHI_DIR"
if [ ! -d "$QCUTILS_DIR" ]; then
    git clone --branch "$QCUTILS_BRANCH" "$QCUTILS_REPO" qcutils
else
    cd "$QCUTILS_DIR"
    git fetch origin
    git checkout "$QCUTILS_BRANCH"
    git reset --hard origin/"$QCUTILS_BRANCH"
fi

# ----------------------------------------
# Step 5: Setup Python venv and install backend
# ----------------------------------------
echo "============================================"
echo "Step 5: Setting up backend"
echo "============================================"
cd "$QIMCHI_DIR/qimchi"
uv venv --python 3.13 --seed --clear
source "$VENV_DIR/bin/activate"

cd "$QIMCHI_DIR/qimchi/backend"
uv pip install .
uv pip install "$QCUTILS_DIR"

# ----------------------------------------
# Step 6: Setup frontend
# ----------------------------------------
echo "============================================"
echo "Step 6: Setting up frontend"
echo "============================================"
cd "$QIMCHI_DIR/qimchi/frontend"
npm install
npm run build

# ----------------------------------------
# Step 7: Create CLI wrapper
# ----------------------------------------
cat > "$CLI_PATH" << EOF
#!/usr/bin/env bash
set -e
QIMCHI_DIR="$QIMCHI_DIR"
PORT=$PORT
source "$VENV_DIR/bin/activate"
cd "\$QIMCHI_DIR/qimchi/backend"
echo "Starting QIMCHI server on http://127.0.0.1:\$PORT"
uvicorn main:app --host 127.0.0.1 --port \$PORT --workers 8 --ws-max-size 200000000
EOF

chmod +x "$CLI_PATH"

# ----------------------------------------
# Step 8: Remind user to update PATH
# ----------------------------------------
echo ""
echo "============================================"
echo "Installation complete"
echo ""
echo "Restart your shell or run:"
echo "export PATH=\"$BIN_DIR:\$PATH\""
echo ""
echo "Then run: qimchi"
echo "Server will be available at: http://127.0.0.1:$PORT"
echo "============================================"