# Vultr instance (Terraform)

Launches a single Vultr compute instance using the [`vultr/vultr`](https://registry.terraform.io/providers/vultr/vultr/latest/docs/resources/instance) provider.

## Prerequisites

- Terraform >= 1.5
- A Vultr API key ([account settings](https://my.vultr.com/settings/#settingsapi))

## Usage

```sh
export VULTR_API_KEY="your-api-key"

cp terraform.tfvars.example terraform.tfvars   # optional: override defaults

terraform init
terraform plan
terraform apply
```

Get the instance IP and root password after apply:

```sh
terraform output main_ip
terraform output -raw default_password
```

Tear it down:

```sh
terraform destroy
```

## Notes

- `os_id` defaults to `1743` (Ubuntu 22.04 LTS x64). List options with `vultr-cli os list`.
- Set `ssh_public_key_path` to register a public key and attach it to the instance, so you can log in without the generated password.
- The API key is read from `VULTR_API_KEY` unless you set `vultr_api_key` explicitly.
