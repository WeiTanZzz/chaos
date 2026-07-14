variable "vultr_api_key" {
  description = "Vultr API key. Leave empty to read from the VULTR_API_KEY environment variable instead."
  type        = string
  default     = ""
  sensitive   = true
}

variable "label" {
  description = "Label shown for the instance in the Vultr console."
  type        = string
  default     = "chaos-instance"
}

variable "hostname" {
  description = "Hostname assigned to the instance."
  type        = string
  default     = "chaos-instance"
}

variable "region" {
  description = "Region ID the instance is created in (e.g. sea = Seattle, ewr = New Jersey, lhr = London)."
  type        = string
  default     = "sea"
}

variable "plan" {
  description = "Plan ID the instance subscribes to (e.g. vc2-1c-1gb = 1 vCPU / 1 GB)."
  type        = string
  default     = "vc2-1c-1gb"
}

# os_id 1743 = Ubuntu 22.04 LTS x64. List available IDs with: vultr-cli os list
variable "os_id" {
  description = "Operating system ID to install."
  type        = number
  default     = 1743
}

variable "enable_ipv6" {
  description = "Attach an IPv6 address to the instance."
  type        = bool
  default     = true
}

variable "backups_enabled" {
  description = "Enable automatic daily backups."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to the instance."
  type        = list(string)
  default     = ["chaos"]
}

# Path to a public SSH key to register and attach. Leave empty to skip SSH key setup.
variable "ssh_public_key_path" {
  description = "Path to a public SSH key file to register and attach to the instance."
  type        = string
  default     = ""
}
