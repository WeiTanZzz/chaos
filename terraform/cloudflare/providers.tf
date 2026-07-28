# token falls back to the CLOUDFLARE_API_TOKEN env var when the variable is
# left empty, so the token never has to be written to a tfvars file.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}
