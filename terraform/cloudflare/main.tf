locals {
  # Flatten { zone => { subdomain => ip } } into one map keyed "zone/subdomain"
  # so every record gets a stable for_each address.
  records = merge([
    for zone_name, subdomains in var.zones : {
      for subdomain, ip_address in subdomains :
      "${zone_name}/${subdomain}" => {
        zone_name = zone_name
        fqdn      = subdomain == "@" ? zone_name : "${subdomain}.${zone_name}"
        ip        = ip_address
      }
    }
  ]...)
}

data "cloudflare_zone" "this" {
  for_each = var.zones

  filter = {
    name = each.key
  }
}

resource "cloudflare_dns_record" "a" {
  for_each = local.records

  zone_id = data.cloudflare_zone.this[each.value.zone_name].id
  name    = each.value.fqdn
  type    = "A"
  content = each.value.ip
  ttl     = 1 # 1 = automatic
  proxied = var.proxied
}
