variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:Read and DNS:Edit permissions. Leave empty to read from the CLOUDFLARE_API_TOKEN environment variable instead."
  type        = string
  default     = ""
  sensitive   = true
}

# Key is the zone name, value maps subdomains to IPv4 addresses.
# Use "@" as the subdomain for the zone apex.
#
# zones = {
#   "example.com" = {
#     "@"   = "203.0.113.10"
#     "www" = "203.0.113.10"
#     "api" = "203.0.113.20"
#   }
# }
variable "zones" {
  description = "Map of zone name to a map of subdomain => IPv4 address. Use \"@\" for the zone apex."
  type        = map(map(string))
}

variable "proxied" {
  description = "Route records through the Cloudflare proxy (orange cloud) instead of DNS-only."
  type        = bool
  default     = true
}
