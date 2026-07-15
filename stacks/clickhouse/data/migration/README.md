# ES → ClickHouse migration (staging/test)

Copies `.ds-entities_history_stream_01-*` from Elasticsearch into the
`entity_history_test` table in a local ClickHouse. Read-only against ES.

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

## Behaviour

- Paginates with a Point-in-Time + `search_after` (5000 docs/page) — never loads the whole stream into memory.
- Creates the table from `../../schema/entity_history_test.sql` if it doesn't exist.
- Flattens `id.*`, `data.*`, `previousData.*` → `prev_*`, and `meta.*` into the target columns.
- **One value per field, multi-values preserved separately.** Source fields are multi-valued arrays. The `data_*` / `prev_*` maps hold the **first** value as a scalar (so `data_numberFields['x']` reads naturally), and any field carrying more than one value is *also* kept in full in the `data_multiValues` / `prev_multiValues` overflow maps (`Map(String, Array(String))`, values stringified) — e.g. `data_multiValues['text_last_update_by'] = ['uuid', 'hash']`. Empty arrays are omitted and single-value fields never touch the overflow, so both stay sparse. The run prints the top 20 most multi-valued fields.
- **Dirty data is dropped silently, not fatal**: a value that can't be cast (e.g. text in `numberFields`) is dropped from that map and counted; empty/uncastable fields are omitted. At the end it prints the top 20 most-dropped field names.
- The scalar `meta_createdBy` / `meta_updatedBy` columns take the **first** element of their source arrays (those columns are `String`).
- Documents with an unparseable `@timestamp` are skipped (counted separately) since it's the partition/sort key.
- An insert failure raises with the offending batch index.
