# llama.cpp cheatsheet (Docker)

Run `llama-server` as a container. Assumes Docker is installed (see `../../docker`).

## Get a model

```sh
mkdir -p ~/models
curl -L -o ~/models/Qwen2.5-7B-Instruct-Q4_K_M.gguf \
  https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf
```

## Run

```sh
docker run -d --name llama-server \
  -p 8080:8080 \
  -v ~/models:/models \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/Qwen2.5-7B-Instruct-Q4_K_M.gguf \
  --host 0.0.0.0 --port 8080 \
  -c 8192 -t 8 --jinja
```

- `--host 0.0.0.0` — **required**. Without it the server binds container-local
  loopback and the host cannot reach it.
- `-c` — context length. `-t` — threads, set to the physical core count.
- `--jinja` — use the model's own chat template. Needed for tool calling.
- No `--gpus` on macOS: Docker Desktop cannot reach Metal. CPU only.

## Docker Compose (alternative)

See `compose.yaml`, then:

```sh
docker compose up -d
docker compose logs -f llama
docker compose down          # add -v to also drop the HF download cache
```

## Verify

```sh
curl http://localhost:8080/health
```

```sh
curl -s http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

`http://localhost:8080` also serves a built-in web UI.

## Pull the model instead of mounting it

Skip the manual download and let the server fetch from Hugging Face:

```sh
docker run -d --name llama-server \
  -p 8080:8080 \
  -v llama-cache:/root/.cache/llama.cpp \
  ghcr.io/ggml-org/llama.cpp:server \
  -hf ggml-org/gemma-3-4b-it-GGUF \
  --host 0.0.0.0 --port 8080 --jinja
```

## NVIDIA GPU (Linux only)

Needs the NVIDIA Container Toolkit on the host.

```sh
docker run -d --name llama-server --gpus all \
  -p 8080:8080 \
  -v ~/models:/models \
  ghcr.io/ggml-org/llama.cpp:server-cuda \
  -m /models/Qwen2.5-7B-Instruct-Q4_K_M.gguf \
  --host 0.0.0.0 --port 8080 -ngl 99
```

- `-ngl 99` — offload all layers to the GPU.

## Manage

```sh
docker logs -f llama-server
docker stop llama-server && docker start llama-server
docker rm -f llama-server
```

## Useful flags

| flag | what it does |
|---|---|
| `-ngl N` | layers offloaded to GPU |
| `-c N` | context window |
| `-t N` | CPU threads |
| `--parallel N` | concurrent request slots |
| `--jinja` | model's own chat template (required for tool calls) |
| `--metrics` | expose Prometheus metrics at `/metrics` |
