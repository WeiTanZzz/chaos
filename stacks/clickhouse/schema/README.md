# ClickHouse schema

SQL schema files (`*.sql`) for the ClickHouse stack, and how to run them.
**Staging/test only.**

## Prerequisites

The ClickHouse container from [`../install/compose.yaml`](../install/compose.yaml) is running:

```sh
(cd ../install && docker compose up -d)
```

Connection defaults (from that compose file): host `localhost`, HTTP port `8123`,
user `admin`, password `changeme`. Adjust the commands below if you changed them.

## Run a schema file

Run any `.sql` in this folder against the container. From `stacks/clickhouse/`:

```sh
# HTTP (simplest — uses the exposed 8123 port)
curl -u admin:changeme 'http://localhost:8123/' --data-binary @schema/<file>.sql

# or via the client inside the container
docker exec -i clickhouse clickhouse-client --user admin --password changeme --multiquery \
  < schema/<file>.sql
```

DDL files are written as `CREATE TABLE IF NOT EXISTS`, so re-running is safe.

## Verify

```sh
docker exec clickhouse clickhouse-client --user admin --password changeme --query "SHOW TABLES"
docker exec clickhouse clickhouse-client --user admin --password changeme --query "SHOW CREATE TABLE <table>"
```

## Reset

```sh
# empty a table, keep the schema
docker exec clickhouse clickhouse-client --user admin --password changeme --query "TRUNCATE TABLE <table>"

# drop entirely, then re-run the .sql to recreate
docker exec clickhouse clickhouse-client --user admin --password changeme --query "DROP TABLE <table>"
```

## Files

| File | Table | Populated by |
|------|-------|--------------|
| [`entity_history_test.sql`](entity_history_test.sql) | `entity_history_test` | [`../data/migration/migrate.py`](../data/migration/migrate.py) |

> Note: `migrate.py` runs its schema file automatically on startup, so applying the
> DDL by hand is only needed to provision a table ahead of a migration.
