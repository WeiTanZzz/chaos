# llama.cpp

Self-hosted LLM inference with an OpenAI-compatible API (`llama-server`).

- `install/` — Docker / Compose on a single box.
- `k8s/` — deploying onto the `chaos-k8s` cluster (see `../../terraform/hetzner-k8s`).

## Images

Published at `ghcr.io/ggml-org/llama.cpp`:

| tag | contents |
|---|---|
| `server` | `llama-server` only — the one you usually want |
| `light` | `llama-cli` only |
| `full` | all tools plus the convert/quantize scripts |
| `server-cuda`, `server-vulkan`, `server-rocm` | GPU backends |

The `server` image's entrypoint is already `llama-server`, so container args are
passed straight through to it.

## Models

Models are GGUF files. Either mount a directory containing them and pass
`-m /models/<file>.gguf`, or let the server pull from Hugging Face with
`-hf <user>/<repo>` (cached under `/root/.cache/llama.cpp`).

Check the actual filename before wiring a download URL into automation. Repos
rename files between releases, and larger quants are often **sharded** — the
official `Qwen/Qwen2.5-7B-Instruct-GGUF` ships Q4_K_M as
`...-q4_k_m-00001-of-00002.gguf`, so a single-file URL 404s. List a repo's real
contents with:

```sh
curl -s https://huggingface.co/api/models/<user>/<repo> \
  | python3 -c "import sys,json;[print(s['rfilename']) for s in json.load(sys.stdin)['siblings']]"
```

To use a sharded quant, download every shard and point `-m` at shard `00001`;
llama.cpp loads the rest automatically. The configs here use
`bartowski/Qwen2.5-7B-Instruct-GGUF` instead, which ships Q4_K_M as one file.

## Hardware reality check

Neither target here has a usable GPU:

- **macOS + Docker Desktop** — containers cannot reach Apple Silicon's Metal GPU.
  CPU only, roughly 5–10x slower than a native `brew install llama.cpp` build.
  Use Docker here for parity with the server, not for speed.
- **Hetzner Cloud** — no GPU instances exist in the CX/CPX lines, so `chaos-k8s`
  is CPU only. The `server-cuda` image and `nvidia.com/gpu` resources do not apply.

## Expected throughput on chaos-k8s

Workers are `cpx62`: 16 shared AMD EPYC vCPU, 32 GB RAM, 640 GB NVMe. Token
generation is bound by memory bandwidth, not core count, and shared vCPUs give
less bandwidth than bare metal. Estimates, not measured:

| model | Q4_K_M size | est. tok/s |
|---|---|---|
| 3B–4B | ~2.5 GB | 10–15 |
| 7B–8B | ~4.5 GB | 5–8 |
| 14B | ~9 GB | 2–3 |
| 30B+ | 20 GB+ | < 1, unusable |

Prefill is compute-bound and benefits from the 16 cores (tens of tok/s), but long
prompts still mean a noticeable time-to-first-token.

**7B–8B at Q4_K_M is the sweet spot.** Good enough for async jobs, batch work and
low-frequency internal tooling. Not good enough for interactive chat or anything
user-facing.
