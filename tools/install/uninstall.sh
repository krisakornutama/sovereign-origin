#!/usr/bin/env sh
# Sovereign OS - clean uninstaller (macOS/Linux)
# Default is a dry-run. Add --yes to execute, --purge-data to delete volumes.
set -eu
cd "$(dirname "$0")"
exec node uninstall.mjs "$@"
