# Cloudflare DNS (Terraform)

Manages A records across one or more Cloudflare zones using the [`cloudflare/cloudflare`](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs/resources/dns_record) provider (v5).

Records are declared as a single map — zone name to `subdomain => IP`:

```hcl
zones = {
  "example.com" = {
    "@"   = "203.0.113.10"   # zone apex (example.com)
    "www" = "203.0.113.10"
    "api" = "203.0.113.20"
  }
  "another.dev" = {
    "blog" = "198.51.100.5"
  }
}
```

## Prerequisites

- Terraform >= 1.5
- The zones already added to your Cloudflare account
- A Cloudflare API token ([dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)) with `Zone:Read` and `DNS:Edit` on the zones you manage

## Usage

```sh
export CLOUDFLARE_API_TOKEN="your-api-token"

cp terraform.tfvars.example terraform.tfvars   # set your zones

terraform init
terraform plan
terraform apply
```

List the managed records after apply:

```sh
terraform output records
```

Tear it down:

```sh
terraform destroy
```

## Notes

- Point the IPs at server outputs from the sibling modules (`terraform output ipv4_address` in `../hetzner` or `../vultr`).
- `proxied` defaults to `true` (traffic goes through Cloudflare, real IP hidden). Set it to `false` for plain DNS, e.g. for SSH-only hosts.
- `ttl = 1` means "automatic" in Cloudflare terms; proxied records always use it.
- The token is read from `CLOUDFLARE_API_TOKEN` unless you set `cloudflare_api_token` explicitly.
