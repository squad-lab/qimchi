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

## Command-line flags
FORCE_REINSTALL=0
if [ "$1" = "--force-reinstall" ] || [ "$1" = "-f" ]; then
    FORCE_REINSTALL=1
fi

if [ "$FORCE_REINSTALL" -eq 1 ]; then
    echo "Force reinstall requested. Removing $QIMCHI_DIR..."
    rm -rf "$QIMCHI_DIR"
fi

mkdir -p "$QIMCHI_DIR" "$BIN_DIR"


# Helper: check command existence
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

install_fd() {
    if command_exists fd; then
        echo "fd is already installed."
        return
    fi
    echo "fd not found. Installing..."
    if command_exists brew; then
        brew install fd
    elif command_exists apt-get; then
        sudo apt-get update
        sudo apt-get install -y fd-find
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

remove_qcutils() {
    if [ -d "$QCUTILS_DIR" ]; then
        echo "qcutils found at $QCUTILS_DIR. Removing..."
        rm -rf "$QCUTILS_DIR"
        if [ -d "$QCUTILS_DIR" ]; then
            echo "WARNING: Failed to remove $QCUTILS_DIR. Please remove it manually."
        else
            echo "qcutils removed successfully."
        fi
    else
        echo "No qcutils directory found at $QCUTILS_DIR."
    fi
}

# ----------------------------------------
# Install dependencies
# ----------------------------------------
echo "============================================"
echo "Step 1: Installing dependencies"
echo "============================================"
install_git
install_uv
install_node
install_fd

# ----------------------------------------
# Clone or update QIMCHI
# ----------------------------------------
echo "============================================"
echo "Step 2: Setting up QIMCHI"
echo "============================================"

QIMCHI_TARGET="$QIMCHI_DIR/qimchi"

if [ ! -d "$QIMCHI_TARGET/.git" ]; then
    echo "QIMCHI repository not found. Cloning..."
    git clone "$QIMCHI_REPO" "$QIMCHI_TARGET"
fi

cd "$QIMCHI_TARGET" || exit 1

# Fetch all remote branches
echo "Fetching all remote branches..."
git fetch origin --prune

# List remote branches
remote_branches=($(git ls-remote --heads origin | awk '{print $2}' | sed 's|refs/heads/||'))
default_branch="$DEFAULT_QIMCHI_BRANCH"

# Move default branch to front if exists
for i in "${!remote_branches[@]}"; do
    if [ "${remote_branches[$i]}" = "$default_branch" ]; then
        remote_branches=("$default_branch" "${remote_branches[@]:0:$i}" "${remote_branches[@]:$((i+1))}")
        break
    fi
done

# Print menu
echo "Available QIMCHI branches:"
for i in "${!remote_branches[@]}"; do
    printf "%d) %s\n" $((i+1)) "${remote_branches[$i]}"
done

# Prompt user
read -p "Pick a number for QIMCHI branch (default: 1): " branch_choice < /dev/tty
branch_choice=${branch_choice:-1}
QIMCHI_BRANCH="${remote_branches[$((branch_choice-1))]}"

# Ensure remote branch exists locally and check it out
if git show-ref --verify --quiet "refs/remotes/origin/$QIMCHI_BRANCH"; then
    if git show-ref --verify --quiet "refs/heads/$QIMCHI_BRANCH"; then
        git checkout "$QIMCHI_BRANCH"
    else
        git checkout -b "$QIMCHI_BRANCH" "origin/$QIMCHI_BRANCH"
    fi
    git reset --hard "origin/$QIMCHI_BRANCH"
else
    echo "Error: remote branch origin/$QIMCHI_BRANCH not found!"
    exit 1
fi

# Ensure qcutils folder is removed
remove_qcutils
# ----------------------------------------
# Setup Python venv and install backend
# ----------------------------------------
echo "============================================"
echo "Step 3: Setting up backend"
echo "============================================"
cd "$QIMCHI_DIR/qimchi"

# Create venv in $VENV_DIR
uv venv --python 3.13 --seed --clear "$VENV_DIR"

# Activate it
source "$VENV_DIR/bin/activate"

cd "$QIMCHI_DIR/qimchi/backend"
uv pip install .

# Note: QCUtils is optional and is not installed by this script.

# ----------------------------------------
# Setup frontend
# ----------------------------------------
echo "============================================"
echo "Step 4: Setting up frontend"
echo "============================================"
cd "$QIMCHI_DIR/qimchi/frontend"
npm install
npm run build

# ----------------------------------------
# Create CLI wrapper
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
echo "CLI created at $CLI_PATH"

# Add to PATH in shell rc files
for shell_rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [ -f "$shell_rc" ] && ! grep -q "$BIN_DIR" "$shell_rc"; then
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$shell_rc"
    fi
done

# ----------------------------------------
# Final message
# ----------------------------------------
echo "============================================"
echo "Installation complete!"
echo "Restart your shell or run:"
echo "  export PATH=\"$BIN_DIR:\$PATH\""
echo "Then run: qimchi"
echo "Server will be available at: http://127.0.0.1:$PORT"
echo "============================================"