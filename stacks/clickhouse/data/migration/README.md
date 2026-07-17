# ES → ClickHouse migration (staging/test)

Copies `.ds-entities_history_stream_01-*` from Elasticsearch into the
`entity_history_test` table in a local ClickHouse. Read-only against ES.

## Prerequisites

- Docker (for ClickHouse)
- Python 3.9+ with `venv`

On Debian/Ubuntu the `venv` module ships separately — if `python3 -m venv`
fails with *"ensurepip is not available"*, install it first (match your Python
version, e.g. `python3.14-venv`):

```sh
sudo apt update
sudo apt install python3-venv python3-full
```

> Don't `pip install` into the system Python. Newer distros mark it
> *externally-managed* (PEP 668) and will refuse. Always use the venv below;
> avoid `--break-system-packages`.

## Run

```sh
# 1. Start ClickHouse (from the install stack)
(cd ../../install && docker compose up -d)

# 2. Python env + deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Config
cp .env.example .env      # edit ES URL / auth
set -a; source .env; set +a

# 4. Migrate
python migrate.py
```

## Large migrations (100M+ docs) & resume

A full stream (~365M docs) runs single-threaded at a few thousand rows/s — plan
for many hours. Run it detached so it survives an SSH disconnect, and tune the
batch/PIT knobs:

```sh
export BATCH_SIZE=10000
export ES_PIT_KEEP_ALIVE=10m
nohup python migrate.py > migrate.$(date +%F_%H%M).log 2>&1 &
tail -f migrate.*.log        # watch `total` and `rows/s`
```

`nohup` ignores SIGHUP, so closing the terminal is safe. Reattach later with
`tail -f` / `ps aux | grep migrate.py`.

**Resume** — the run checkpoints after every confirmed insert to
`migrate.checkpoint.json` (the `@timestamp` reached plus the ES `_id`s already
inserted at that exact millisecond). If it dies partway, just start it again:
it reopens a fresh Point-in-Time filtered to `@timestamp >=` the last reached
millisecond and skips the boundary docs it already wrote — no gaps, no
duplicates. The file is deleted automatically on successful completion, so the
next run starts clean.

- To force a full restart, delete `migrate.checkpoint.json` first.
- Override the location with `CHECKPOINT_FILE=/path/to/checkpoint.json`.
- Resume relies on `@timestamp` being the primary sort key. `_shard_doc` (the
  in-run tiebreaker) is PIT-local and deliberately *not* checkpointed — reusing
  it across PITs would silently skip documents.

## Behaviour

- Paginates with a Point-in-Time + `search_after` (5000 docs/page) — never loads the whole stream into memory.
- Creates the table from `../../schema/entity_history_test.sql` if it doesn't exist.
- Flattens `id.*`, `data.*`, `previousData.*` → `prev_*`, and `meta.*` into the target columns.
- **One value per field, multi-values preserved separately.** Source fields are multi-valued arrays. The `data_*` / `prev_*` maps hold the **first** value as a scalar (so `data_numberFields['x']` reads naturally), and any field carrying more than one value is *also* kept in full in the `data_multiValues` / `prev_multiValues` overflow maps (`Map(String, Array(String))`, values stringified) — e.g. `data_multiValues['text_last_update_by'] = ['uuid', 'hash']`. Empty arrays are omitted and single-value fields never touch the overflow, so both stay sparse. The run prints the top 20 most multi-valued fields.
- **Dirty data is dropped silently, not fatal**: a value that can't be cast (e.g. text in `numberFields`) is dropped from that map and counted; empty/uncastable fields are omitted. At the end it prints the top 20 most-dropped field names.
- The scalar `meta_createdBy` / `meta_updatedBy` columns take the **first** element of their source arrays (those columns are `String`).
- Documents with an unparseable `@timestamp` are skipped (counted separately) since it's the partition/sort key.
- An insert failure raises with the offending batch index.
