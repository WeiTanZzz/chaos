variable "hcloud_token" {
  description = "Hetzner Cloud API token. Leave empty to read from the HCLOUD_TOKEN environment variable instead."
  type        = string
  default     = ""
  sensitive   = true
}

variable "name" {
  description = "Name of the server, also used as its hostname."
  type        = string
  default     = "chaos-instance"
}

variable "location" {
  description = "Location the server is created in (e.g. fsn1 = Falkenstein, nbg1 = Nuremberg, hel1 = Helsinki, ash = Ashburn)."
  type        = string
  default     = "fsn1"
}

variable "server_type" {
  description = "Server type the instance subscribes to (e.g. cx23 = 2 vCPU / 4 GB shared Intel)."
  type        = string
  default     = "cx23"
}

# List available images with: hcloud image list --type system
variable "image" {
  description = "Operating system image to install."
  type        = string
  default     = "ubuntu-22.04"
}

variable "enable_ipv6" {
  description = "Attach an IPv6 address to the server."
  type        = bool
  default     = true
}

variable "backups_enabled" {
  description = "Enable automatic backups (adds 20% to the server price)."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Labels applied to the server."
  type        = map(string)
  default     = { purpose = "chaos" }
}

# Path to a public SSH key to register and attach. Leave empty to skip SSH key setup.
variable "ssh_public_key_path" {
  description = "Path to a public SSH key file to register and attach to the server."
  type        = string
  default     = ""
}
