#!/bin/bash
set -euo pipefail
source_dir="$1"
windows_home="$2"
version="$3"
export SSH_HOLD_DESKTOP_TOKEN="$4"
backend_root="$HOME/.local/share/ssh-hold-deck/backend"
backend="$backend_root/$version"
mkdir -p "$backend_root"
# Always replace resources from this installer, including rebuilds of the same version.
staging=$(mktemp -d "$backend_root/.prepare-XXXXXXXX")
trap 'rm -rf "$staging"' EXIT
cp -R "$source_dir/." "$staging/"
chmod +x "$staging/runtime/node"
mv "$staging" "$backend.new"
old="$backend_root/.previous-$$"
if [ -d "$backend" ]; then mv "$backend" "$old"; fi
mv "$backend.new" "$backend"
rm -rf "$old"
trap - EXIT
export HOST=127.0.0.1
export SSH_HOLD_WEB_DATA_DIR="$HOME/.local/share/ssh-hold-deck/data"
export SSH_HOLD_WINDOWS_HOME="$windows_home"
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$backend"
exec "$backend/runtime/node" "$backend/backend-entry.mjs"
