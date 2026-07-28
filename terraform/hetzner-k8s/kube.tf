variable "hcloud_token" {
  description = "Hetzner Cloud API token. Leave empty to read from the TF_VAR_hcloud_token environment variable."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cluster_name" {
  description = "Name of the cluster, used as prefix for all resources."
  type        = string
  default     = "chaos-k8s"
}

variable "network_region" {
  description = "Hetzner network region the cluster lives in (eu-central, us-east, us-west, ap-southeast)."
  type        = string
  default     = "eu-central"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key used to access cluster nodes."
  type        = string
  default     = "~/.ssh/vultr_ed25519.pub"
}

variable "ssh_private_key_path" {
  description = "Path to the matching SSH private key (must be passphrase-less)."
  type        = string
  default     = "~/.ssh/vultr_ed25519"
}

# Each pool: labels are k8s node labels ("key=value"), taints are k8s node
# taints ("key=value:NoSchedule"). Changing server_type recreates the pool's
# nodes; pool names cannot be renamed after creation.
variable "control_plane_nodepools" {
  description = "Control plane node pools. Keep the total count odd (1, 3, 5) for etcd quorum."
  type = list(object({
    name        = string
    server_type = string
    location    = string
    labels      = list(string)
    taints      = list(string)
    count       = number
  }))
}

variable "agent_nodepools" {
  description = "Worker (agent) node pools. Scale by changing count or adding pools."
  type = list(object({
    name        = string
    server_type = string
    location    = string
    labels      = list(string)
    taints      = list(string)
    count       = number
  }))
  default = []
}

variable "allow_scheduling_on_control_plane" {
  description = "Allow regular workloads on control plane nodes. Set to false once you have dedicated workers."
  type        = bool
  default     = true
}

variable "ingress_controller" {
  description = "Ingress controller to deploy: traefik, nginx, haproxy or none. Anything but none creates a Hetzner load balancer (~€6/mo)."
  type        = string
  default     = "none"
}

locals {
  all_nodepools = concat(var.control_plane_nodepools, var.agent_nodepools)

  # cax server types are ARM, everything else x86; drives which OS snapshots the module looks up
  enabled_architectures = distinct([
    for nodepool in local.all_nodepools : substr(nodepool.server_type, 0, 3) == "cax" ? "arm" : "x86"
  ])
}

module "kube-hetzner" {
  source  = "kube-hetzner/kube-hetzner/hcloud"
  version = "3.0.1"

  providers = {
    hcloud = hcloud
  }

  hcloud_token = var.hcloud_token

  ssh_public_key  = file(var.ssh_public_key_path)
  ssh_private_key = file(var.ssh_private_key_path)

  cluster_name   = var.cluster_name
  network_region = var.network_region

  enabled_architectures = local.enabled_architectures

  control_plane_nodepools = var.control_plane_nodepools
  agent_nodepools         = var.agent_nodepools

  allow_scheduling_on_control_plane = var.allow_scheduling_on_control_plane

  ingress_controller = var.ingress_controller
}

provider "hcloud" {
  token = var.hcloud_token
}

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.51.0"
    }
  }
}

output "kubeconfig" {
  value     = module.kube-hetzner.kubeconfig
  sensitive = true
}
