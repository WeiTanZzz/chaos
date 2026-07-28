# Hetzner Cloud server (Terraform)

Launches a single Hetzner Cloud server using the [`hetznercloud/hcloud`](https://registry.terraform.io/providers/hetznercloud/hcloud/latest/docs/resources/server) provider.

## Prerequisites

- Terraform >= 1.5
- A Hetzner Cloud API token ([project → Security → API tokens](https://console.hetzner.cloud/), needs Read & Write)

## Usage

```sh
export HCLOUD_TOKEN="your-api-token"

cp terraform.tfvars.example terraform.tfvars   # optional: override defaults

terraform init
terraform plan
terraform apply
```

Get the server IP after apply:

```sh
terraform output ipv4_address
```

Tear it down:

```sh
terraform destroy
```

## Notes

- `image` defaults to `ubuntu-22.04`. List options with `hcloud image list --type system`.
- `server_type` defaults to `cx23` (2 vCPU / 4 GB shared Intel, Gen3). List options with `hcloud server-type list`. The `cx` and `cax` families are only available in the EU locations (`fsn1`, `nbg1`, `hel1`); US/Singapore (`ash`, `hil`, `sin`) only offer `cpx` (shared AMD) and `ccx` (dedicated AMD).
- Set `ssh_public_key_path` to register a public key and attach it to the server. Without a key, Hetzner emails a generated root password instead.
- The token is read from `HCLOUD_TOKEN` unless you set `hcloud_token` explicitly.
