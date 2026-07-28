# token falls back to the HCLOUD_TOKEN env var when the variable is left empty,
# so the token never has to be written to a tfvars file.
provider "hcloud" {
  token = var.hcloud_token != "" ? var.hcloud_token : null
}
