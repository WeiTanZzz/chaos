locals {
  ssh_key_enabled = var.ssh_public_key_path != ""
}

resource "vultr_ssh_key" "this" {
  count   = local.ssh_key_enabled ? 1 : 0
  name    = "${var.label}-key"
  ssh_key = trimspace(file(var.ssh_public_key_path))
}

resource "vultr_instance" "this" {
  region      = var.region
  plan        = var.plan
  os_id       = var.os_id
  label       = var.label
  hostname    = var.hostname
  tags        = var.tags
  enable_ipv6 = var.enable_ipv6
  backups     = var.backups_enabled ? "enabled" : "disabled"

  ssh_key_ids = local.ssh_key_enabled ? [vultr_ssh_key.this[0].id] : []

  dynamic "backups_schedule" {
    for_each = var.backups_enabled ? [1] : []
    content {
      type = "daily"
    }
  }
}
