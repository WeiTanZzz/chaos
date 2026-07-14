#!/usr/bin/env bash
# Install Docker Engine on Linux (Ubuntu/Debian) via the official script.
set -euo pipefail

curl -fsSL https://get.docker.com | sudo sh

# Run docker without sudo (takes effect on next login).
sudo usermod -aG docker "$USER"

echo "Docker installed. Log out/in or run 'newgrp docker', then: docker run --rm hello-world"
