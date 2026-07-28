output "records" {
  description = "Managed A records as fqdn => IPv4 address."
  value       = { for record in cloudflare_dns_record.a : record.name => record.content }
}
