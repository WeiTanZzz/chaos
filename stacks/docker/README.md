# Docker cheatsheet

Quick commands for a fresh Linux box (Ubuntu/Debian). Run on the VM.

## Install

```sh
curl -fsSL https://get.docker.com | sudo sh
```

## Post-install (run docker without sudo)

```sh
sudo usermod -aG docker "$USER"
newgrp docker            # apply now, or just log out/in
```

## Verify

```sh
docker run --rm hello-world
docker --version
docker compose version
```

## Uninstall

```sh
sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo rm -rf /var/lib/docker /var/lib/containerd
```
