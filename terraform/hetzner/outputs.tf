output "server_id" {
  description = "Hetzner Cloud server ID."
  value       = hcloud_server.this.id
}

output "ipv4_address" {
  description = "Primary public IPv4 address."
  value       = hcloud_server.this.ipv4_address
}

output "ipv6_address" {
  description = "Primary public IPv6 address (empty when IPv6 is disabled)."
  value       = hcloud_server.this.ipv6_address
}

output "status" {
  description = "Current status of the server."
  value       = hcloud_server.this.status
}
