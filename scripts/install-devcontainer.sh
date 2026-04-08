#!/usr/bin/env bash
set -euo pipefail

bash ./scripts/install-deps.sh
bash ./scripts/install-playwright-deps.sh

echo "Devcontainer setup complete."
