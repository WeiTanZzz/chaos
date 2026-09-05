# Measured on chaos-k8s

Everything here was measured on the live cluster on 2026-09-05. Nothing is
extrapolated unless it says so.

## Setup

| | |
|---|---|
| workers | 2 × `cpx62` — 16 shared AMD EPYC vCPU, 32 GB RAM, 640 GB NVMe |
| node allocatable | 15.5 CPU, 30.0 GiB memory, 621 GB ephemeral |
| k8s | `v1.36.4+k3s1`, containerd 2.3.4 |
| server | `ghcr.io/ggml-org/llama.cpp:server`, `-t 14`, one replica per worker |
| load | fixed prompt, `max_tokens: 200`, `ignore_eos: true`, non-streaming |
| metric | aggregate generated tokens ÷ wall time for the whole batch |

Every run is preceded by warm-up requests. The weights are mmapped, so a cold
first request pages them in off the network volume and reads 20–60% low — the
7B measured 26 tok/s cold against 34 warm. Do not benchmark the first request.

The 7B numbers were driven through `kubectl port-forward` from a laptop; the
35B numbers from a pod inside the cluster. The in-cluster path is the honest
one, so the 7B figures may be slightly understated.

## Generation throughput

Aggregate tok/s across both replicas, at the client concurrency that produced
the peak.

| model | `--parallel` | peak agg tok/s | at concurrency | single-request tok/s |
|---|---|---|---|---|
| Qwen2.5-7B-Instruct Q4_K_M (4.68 GB) | 1 | 61.0 | 8 | 34 |
| Qwen2.5-7B-Instruct Q4_K_M | 4 | 140.2 | 16 | 33 |
| Qwen2.5-7B-Instruct Q4_K_M | 8 | **173.6** | 32 | 34 |
| Qwen3.6-35B-A3B UD-Q4_K_M (22.13 GB) | 4 | 92.1 | 8 | 28 |
| Qwen3.6-35B-A3B UD-Q4_K_M | 8 | **100.6** | 16 | 28 |

Full sweeps, aggregate tok/s (per-request tok/s in brackets):

**Qwen2.5-7B, both replicas**

| concurrency | `--parallel 1` | `--parallel 4` | `--parallel 8` |
|---|---|---|---|
| 2 | 53.3 (26.6) | 53.5 (26.7) | — |
| 4 | 56.2 (14.1) | 78.9 (19.7) | — |
| 8 | 61.0 (7.6) | 132.8 (16.6) | 120.8 (15.1) |
| 16 | — | 140.2 (8.8) | 157.0 (9.8) |
| 32 | — | — | 173.6 (5.4) |

**Qwen3.6-35B-A3B, both replicas**

| concurrency | `--parallel 4` | `--parallel 8` |
|---|---|---|
| 2 | 48.6 (24.3) | 46.5 (23.3) |
| 4 | 63.1 (15.8) | — |
| 8 | 92.1 (11.5) | 93.6 (11.7) |
| 16 | 83.3 (5.2) | 100.6 (6.3) |
| 32 | — | 88.9 (2.8) |

Prefill measured separately at 120–140 tok/s.

## `--parallel` is close to free

Raising the slot count roughly triples aggregate throughput on the 7B and
doubles it on the 35B, and costs **nothing** in single-request latency: 34, 33
and 34 tok/s at `--parallel` 1, 4 and 8 respectively.

CPU generation is memory-bandwidth bound. Batching N sequences reads the weights
once per step and produces N tokens, so slots add real capacity rather than
splitting a fixed budget. `--parallel 1` leaves two thirds of the machine idle.

The cost is context, not speed: `-c` is the **total** KV budget, divided across
slots. `-c 16384 --parallel 8` gives each conversation only 2048 tokens.

## MoE does not deliver "active-parameter speed" on CPU

`Qwen3.6-35B-A3B` activates 3B of 35B parameters per token. The bandwidth model
therefore predicts it should behave like a ~2 GB model. It does not.

| | tok/s |
|---|---|
| if it were a dense 35B (22.1 GB read per token) | 7.2 (predicted) |
| if 3B-active fully materialised (1.9 GB per token) | 84 (predicted) |
| **measured** | **28** |
| Qwen2.5-7B dense, for reference | 34 (measured) |

So MoE is worth ~3.9x over a dense model of the same size, but realises only a
third of the arithmetic — landing slightly *below* a 7B dense model rather than
well above it.

Why the discount is so steep on CPU: which 3B is active changes every token, so
all 22 GB must stay resident and is walked randomly — no sequential streaming,
prefetchers useless. At batch 1, routing to 8 experts means 8 skinny matmuls
instead of one fat GEMM.

Batching does not rescue it. Scaling from single-request to peak is 5.1x for the
dense 7B but only 3.6x for the MoE: with 8 slots the tokens scatter across
different experts, so each expert still sees a tiny batch.

## The 35B is at the memory ceiling

Running `Qwen3.6-35B-A3B` the container sits at **28.6 GiB against a 29 GiB
limit**, on a node with 30.0 GiB allocatable. Context cannot grow from here —
pushing `-c` further starts evicting pages, and every eviction means re-reading
weights off the network volume.

22 GB of weights is this hardware's ceiling, not its comfortable operating
point. The 7B leaves 25 GB of headroom and can take a much larger context.

## Model download and start-up

| | |
|---|---|
| 4.68 GB GGUF from Hugging Face | 42 s / 18 s (110–260 MB/s) |
| 22.13 GB GGUF from Hugging Face | 299 s (74 MB/s) |
| `llama.cpp:server` image (311 MB) from ghcr.io | 17.3 s (~18 MB/s) |
| mmap of the 4.68 GB GGUF | 2.5 s |
| scheduled → `Ready`, 7B | 74 s |

Hugging Face is 4–14x faster than ghcr.io from these nodes, and cold start is
~75 s rather than the ten minutes the `startupProbe` budgets.

## Cost per token

Two `cpx62` workers at €183.59/month = **€367.18/month**. A month is 730 hours
= 2,628,000 seconds. Output tokens only; the control plane and volumes are extra.

| config | peak tok/s | tokens/month at 100% load | €/M output tokens |
|---|---|---|---|
| 7B, `--parallel 1` | 61 | 160M | €2.29 |
| 7B, `--parallel 8` | 174 | 456M | €0.80 |
| 35B-A3B, `--parallel 4` | 92 | 242M | €1.52 |
| 35B-A3B, `--parallel 8` | 101 | 264M | €1.39 |

The same model on OpenRouter is $0.70/M output (≈ €0.64). So **even saturated
24/7, self-hosting costs 2.2x the API price for the same model**. Breaking even
needs 218 tok/s sustained — 2.2x this cluster's measured peak — so on this
hardware the break-even point does not exist.

At realistic single-user volumes it is not close: 10M tokens/month works out to
€36.72/M, and 1M tokens/month to €367/M.

Self-hosting here buys data residency, offline availability and a fixed bill.
It does not buy cheaper tokens.

## Reproducing

A `bench` pod and `bench-script` ConfigMap are left in the `llm` namespace:

```sh
kubectl -n llm exec bench -- python3 /bench/bench.py \
  http://llama-server-0.llama-server-headless.llm.svc.cluster.local:8080,http://llama-server-1.llama-server-headless.llm.svc.cluster.local:8080 \
  200 2,8,16
```

Arguments are comma-separated target URLs, `max_tokens`, and a comma-separated
list of concurrency levels.
