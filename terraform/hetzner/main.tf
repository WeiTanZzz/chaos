locals {
  ssh_key_enabled = var.ssh_public_key_path != ""
}

resource "hcloud_ssh_key" "this" {
  count      = local.ssh_key_enabled ? 1 : 0
  name       = "${var.name}-key"
  public_key = trimspace(file(var.ssh_public_key_path))
}

resource "hcloud_server" "this" {
  name        = var.name
  location    = var.location
  server_type = var.server_type
  image       = var.image
  labels      = var.labels
  backups     = var.backups_enabled

  ssh_keys = local.ssh_key_enabled ? [hcloud_ssh_key.this[0].id] : []

  public_net {
    ipv4_enabled = true
    ipv6_enabled = var.enable_ipv6
  }
}
