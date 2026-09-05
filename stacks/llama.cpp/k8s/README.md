# llama.cpp on Kubernetes

Deploys `llama-server` onto `chaos-k8s` (provisioned by `../../../terraform/hetzner-k8s`).

Read `../README.md` first for measured throughput — this cluster has no GPU,
but a 7B Q4_K_M still generates ~34 tok/s per replica.

## Cluster shape

| role | type | spec | count |
|---|---|---|---|
| control plane | `cx23` | 2 vCPU / 4 GB / 40 GB NVMe | 1 |
| worker | `cpx62` | 16 vCPU (shared AMD EPYC) / 32 GB / 640 GB NVMe | 2 |

`allow_scheduling_on_control_plane = false`, so schedulable capacity is
2 × (16 vCPU / 32 GB). The manifest runs one replica per worker.

## Deploy

```sh
kubectl apply -f llama.yaml
```

First start is slow: the init container downloads ~4.5 GB before the server
loads it. Watch it:

```sh
kubectl -n llm get pods -w
```

```sh
kubectl -n llm logs -f llama-server-0 -c fetch-model
```

## Access

In-cluster: `http://llama-server.llm.svc.cluster.local/v1/chat/completions`

`ingress_controller = "none"` in the Terraform config, so there is no external
entry point. For local access:

```sh
kubectl -n llm port-forward svc/llama-server 8080:80
```

To expose it properly, either add a `NodePort` service or set
`ingress_controller = "traefik"` in `terraform.tfvars` (creates a Hetzner load
balancer, ~€6/mo).

## Why the manifest looks like this

**StatefulSet, not Deployment.** Hetzner Cloud Volumes (`hcloud-csi`) are block
devices and only support `ReadWriteOnce` — there is no RWX class here, so
replicas cannot share one model PVC. `volumeClaimTemplates` gives each replica
its own volume instead. The cost is that every replica downloads its own copy.

**`storageClassName: hcloud-volumes`** is the only class on this cluster —
kube-hetzner disables k3s's built-in `local-storage`, so there is no `local-path`
and the worker's 640 GB local NVMe is not reachable through a PVC:

```sh
kubectl get sc
# NAME                       PROVISIONER         VOLUMEBINDINGMODE
# hcloud-volumes (default)   csi.hetzner.cloud   WaitForFirstConsumer
```

These are network-attached, so the first model load is slower than local disk.
If that startup cost matters more than persistence, swap the volume for an
`emptyDir` — it lands on the node's NVMe and is fast, at the price of
re-downloading the model on every pod restart.

**No `limits.cpu`.** llama.cpp's inference threads spin-wait. Under cgroup CFS
throttling that collapses throughput. Only memory is capped. If you need
Guaranteed QoS instead, set `requests.cpu == limits.cpu`.

**`-t 14` on a 16 vCPU node** leaves headroom for kubelet, CNI and other pods.
Oversubscribing makes it slower, not faster.

**`startupProbe` with `failureThreshold: 60`** allows 10 minutes for model load.
Without it the liveness probe kills the pod mid-load and it restarts forever.

## Scaling

CPU utilisation is useless as an HPA metric here — inference pins the cores to
100% by definition. Scale on the queue instead, using the Prometheus metrics
that `--metrics` exposes (`llamacpp:requests_processing`), via KEDA or a custom
metrics adapter.

Replicas are also capped by the node count: each one wants a whole worker, so
`replicas: 2` is the ceiling until `agent_nodepools[].count` goes up.

Before adding nodes, raise `--parallel`. Measured, it roughly triples aggregate
throughput at no cost to single-request latency — see
[`BENCHMARKS.md`](BENCHMARKS.md), which also records what each model actually
costs per million tokens on this hardware.

## Changing the model

Edit both the `MODEL_FILE`/`MODEL_URL` env vars in the init container and the
`-m` path in the server args. Verify the filename against the repo's real
contents first (see `../README.md`) — a wrong name means the init container
404s and the pod sits in `Init:Error` with a `BackOff` loop.

Then force a re-pull:

```sh
kubectl -n llm delete pvc -l app=llama-server
```

```sh
kubectl -n llm rollout restart statefulset/llama-server
```
