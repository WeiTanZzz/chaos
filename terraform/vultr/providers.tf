# api_key falls back to the VULTR_API_KEY env var when the variable is left empty,
# so the key never has to be written to a tfvars file.
provider "vultr" {
  api_key     = var.vultr_api_key != "" ? var.vultr_api_key : null
  rate_limit  = 100
  retry_limit = 3
}
