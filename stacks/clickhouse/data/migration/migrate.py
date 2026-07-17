#!/usr/bin/env python3
"""Migrate documents from an Elasticsearch data stream into a local ClickHouse
instance for STAGING/TEST use.

Read-only against Elasticsearch. Paginates with a Point-in-Time + search_after
so the full stream is never held in memory. Config comes from environment
variables (see .env.example).
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import clickhouse_connect
from elasticsearch import Elasticsearch

LOG = logging.getLogger("es_to_clickhouse")

INDEX_PATTERN = os.environ.get("ES_INDEX_PATTERN", ".ds-entities_history_stream_01-*")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "5000"))
PIT_KEEP_ALIVE = os.environ.get("ES_PIT_KEEP_ALIVE", "2m")
TABLE_NAME = "entity_history_test"
SCHEMA_FILE = Path(__file__).resolve().parents[2] / "schema" / "entity_history_test.sql"
CHECKPOINT_FILE = Path(os.environ.get("CHECKPOINT_FILE", Path(__file__).resolve().parent / "migrate.checkpoint.json"))

# Order here must match the row lists built in build_row().
COLUMNS = [
    "@timestamp",
    "id_client",
    "id_entityType",
    "id_reference",
    "changedFields",
    "data_textFields",
    "data_numberFields",
    "data_dateFields",
    "data_booleanFields",
    "data_multiValues",
    "prev_textFields",
    "prev_numberFields",
    "prev_dateFields",
    "prev_booleanFields",
    "prev_multiValues",
    "meta_createdBy",
    "meta_updatedBy",
    "meta_updatedSource",
    "meta_shortId",
    "meta_correlationId",
    "meta_createdTime",
    "meta_updateTime",
]


def build_es_client() -> Elasticsearch:
    url = os.environ.get("ES_URL", "https://localhost:9200")
    verify_certs = os.environ.get("ES_VERIFY_CERTS", "false").lower() == "true"
    kwargs = {"verify_certs": verify_certs, "request_timeout": 120}
    if not verify_certs:
        kwargs["ssl_show_warn"] = False

    api_key = os.environ.get("ES_API_KEY")
    username = os.environ.get("ES_USERNAME")
    password = os.environ.get("ES_PASSWORD")
    if api_key:
        kwargs["api_key"] = api_key
    elif username and password:
        kwargs["basic_auth"] = (username, password)

    return Elasticsearch(url, **kwargs)


def build_clickhouse_client():
    return clickhouse_connect.get_client(
        host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
    )


def create_table(clickhouse) -> None:
    ddl = SCHEMA_FILE.read_text().strip().rstrip(";")
    clickhouse.command(ddl)
    LOG.info("ensured table %s exists", TABLE_NAME)


def load_checkpoint() -> dict | None:
    """Resume point from a previous run: the @timestamp (epoch millis) reached
    and the ES _ids already inserted at exactly that millisecond. Returns None
    for a fresh run.
    """
    if not CHECKPOINT_FILE.exists():
        return None
    data = json.loads(CHECKPOINT_FILE.read_text())
    return {"after_millis": int(data["after_millis"]), "seen_ids": set(data["seen_ids"])}


def save_checkpoint(after_millis: int, seen_ids: set) -> None:
    """Atomic write (temp + rename) so a crash mid-write can't corrupt the file."""
    temp_file = CHECKPOINT_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps({"after_millis": after_millis, "seen_ids": sorted(seen_ids)}))
    temp_file.replace(CHECKPOINT_FILE)


def parse_datetime(value) -> datetime:
    """epoch_millis (int/float/digit-string) or ISO-8601 string -> naive UTC datetime."""
    if isinstance(value, bool) or value is None:
        raise ValueError(f"not a datetime: {value!r}")
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc).replace(tzinfo=None)
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            return datetime.fromtimestamp(int(text) / 1000.0, tz=timezone.utc).replace(tzinfo=None)
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    raise ValueError(f"unsupported datetime: {value!r}")


def to_text(value) -> str:
    if value is None:
        raise ValueError("null text")
    return str(value)


def to_float(value) -> float:
    if value is None or isinstance(value, bool):
        raise ValueError(f"not a float: {value!r}")
    return float(value)


def to_uint8(value) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        if value in (0, 1):
            return int(value)
        raise ValueError(f"not 0/1: {value!r}")
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "y", "t"):
            return 1
        if lowered in ("false", "0", "no", "n", "f"):
            return 0
    raise ValueError(f"not a bool: {value!r}")


def to_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def unwrap(raw):
    """Scalar view of a possibly-array ES field. Returns (value, present).

    Used for the top-level @timestamp and the scalar meta_* columns, where the
    schema holds a single value. present=False means empty array or null.
    """
    if isinstance(raw, list):
        if not raw:
            return None, False
        return raw[0], True
    if raw is None:
        return None, False
    return raw, True


def scalar_str(raw) -> str:
    value, present = unwrap(raw)
    return str(value) if present else ""


def scalar_int(raw) -> int:
    value, present = unwrap(raw)
    return to_int(value) if present else 0


def build_map(group, converter, dropped: Counter, count_drops: bool) -> dict:
    """First value per field — the source arrays are collapsed to a scalar for
    ergonomic querying. A value that fails to cast is dropped and counted; empty
    fields are omitted. Fields with more than one value are preserved separately
    by collect_multivalues().
    """
    result: dict = {}
    if not isinstance(group, dict):
        return result
    for field_name, raw in group.items():
        value, present = unwrap(raw)
        if not present:
            continue
        try:
            result[field_name] = converter(value)
        except (ValueError, TypeError):
            if count_drops:
                dropped[field_name] += 1
    return result


def collect_multivalues(groups, multivalue: Counter) -> dict:
    """Overflow map holding every field whose source array carried more than one
    value (e.g. text_last_update_by = [uuid, hash]). Field names are uniquely
    prefixed per group, so all groups on one side share a single map with no
    collisions. Values are stringified for a uniform Array(String) column.
    """
    result: dict = {}
    for group in groups:
        if not isinstance(group, dict):
            continue
        for field_name, raw in group.items():
            if isinstance(raw, list) and len(raw) > 1:
                result[field_name] = [str(element) for element in raw if element is not None]
                multivalue[field_name] += 1
    return result


def build_row(source: dict, dropped: Counter, multivalue: Counter, skipped: Counter):
    timestamp_value, present = unwrap(source.get("@timestamp"))
    if not present:
        skipped["missing_timestamp"] += 1
        return None
    try:
        timestamp = parse_datetime(timestamp_value)
    except (ValueError, TypeError):
        skipped["bad_timestamp"] += 1
        return None

    identifiers = source.get("id") or {}
    data = source.get("data") or {}
    previous = source.get("previousData") or {}
    meta = source.get("meta") or {}

    changed = source.get("changedFields")
    if not isinstance(changed, list):
        changed = []

    data_groups = [data.get("textFields"), data.get("numberFields"), data.get("dateFields"), data.get("booleanFields")]
    prev_groups = [previous.get("textFields"), previous.get("numberFields"), previous.get("dateFields"), previous.get("booleanFields")]

    return [
        timestamp,
        scalar_str(identifiers.get("client")),
        scalar_str(identifiers.get("entityType")),
        scalar_str(identifiers.get("reference")),
        [str(field) for field in changed],
        build_map(data.get("textFields"), to_text, dropped, False),
        build_map(data.get("numberFields"), to_float, dropped, True),
        build_map(data.get("dateFields"), parse_datetime, dropped, True),
        build_map(data.get("booleanFields"), to_uint8, dropped, True),
        collect_multivalues(data_groups, multivalue),
        build_map(previous.get("textFields"), to_text, dropped, False),
        build_map(previous.get("numberFields"), to_float, dropped, True),
        build_map(previous.get("dateFields"), parse_datetime, dropped, True),
        build_map(previous.get("booleanFields"), to_uint8, dropped, True),
        collect_multivalues(prev_groups, multivalue),
        scalar_str(meta.get("createdBy")),
        scalar_str(meta.get("updatedBy")),
        scalar_str(meta.get("updatedSource")),
        scalar_str(meta.get("shortId")),
        scalar_str(meta.get("correlationId")),
        scalar_int(meta.get("createdTime")),
        scalar_int(meta.get("updateTime")),
    ]


def iterate_documents(elasticsearch: Elasticsearch, resume_after_millis: int | None = None):
    """Yield lists of hits, one list per BATCH_SIZE page, via PIT + search_after.

    _shard_doc is a PIT-local tiebreaker, so a search_after value from one PIT is
    meaningless in another — it cannot be checkpointed across process restarts.
    To resume, we instead reopen a fresh PIT and filter @timestamp >= the last
    reached millisecond; the caller skips the boundary docs it already inserted.
    """
    pit_id = elasticsearch.open_point_in_time(index=INDEX_PATTERN, keep_alive=PIT_KEEP_ALIVE)["id"]
    query = {"match_all": {}}
    if resume_after_millis is not None:
        query = {"range": {"@timestamp": {"gte": resume_after_millis, "format": "epoch_millis"}}}
    search_after = None
    try:
        while True:
            params = {
                "size": BATCH_SIZE,
                "query": query,
                # _shard_doc is a stable tiebreaker only available with a PIT.
                "sort": [{"@timestamp": "asc"}, {"_shard_doc": "asc"}],
                "track_total_hits": False,
                "pit": {"id": pit_id, "keep_alive": PIT_KEEP_ALIVE},
            }
            if search_after is not None:
                params["search_after"] = search_after

            response = elasticsearch.search(**params)
            hits = response["hits"]["hits"]
            if not hits:
                break

            refreshed_pit = response.get("pit_id")
            if refreshed_pit:
                pit_id = refreshed_pit

            yield hits
            search_after = hits[-1]["sort"]
    finally:
        try:
            elasticsearch.close_point_in_time(id=pit_id)
        except Exception as exc:
            LOG.warning("failed to close point-in-time: %s", exc)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    elasticsearch = build_es_client()
    clickhouse = build_clickhouse_client()
    create_table(clickhouse)

    checkpoint = load_checkpoint()
    resume_after = checkpoint["after_millis"] if checkpoint is not None else None
    # Boundary docs already inserted at exactly resume_after; skipped on the way back in.
    seen_ids = checkpoint["seen_ids"] if checkpoint is not None else set()
    boundary_ts = resume_after
    boundary_ids = set(seen_ids)

    if checkpoint is not None:
        LOG.info("resuming from checkpoint: @timestamp >= %d, skipping %d already-inserted boundary docs", resume_after, len(seen_ids))

    dropped: Counter = Counter()
    multivalue: Counter = Counter()
    skipped: Counter = Counter()
    total_rows = 0
    started = time.monotonic()

    LOG.info("migrating %s -> %s (batch size %d)", INDEX_PATTERN, TABLE_NAME, BATCH_SIZE)

    for batch_index, hits in enumerate(iterate_documents(elasticsearch, resume_after_millis=resume_after)):
        if seen_ids:
            hits = [hit for hit in hits if not (hit["sort"][0] == resume_after and hit["_id"] in seen_ids)]
        if not hits:
            continue

        sources = [hit.get("_source", {}) for hit in hits]
        rows = [row for row in (build_row(source, dropped, multivalue, skipped) for source in sources) if row is not None]
        if rows:
            try:
                clickhouse.insert(TABLE_NAME, rows, column_names=COLUMNS)
            except Exception as exc:
                raise RuntimeError(f"ClickHouse insert failed for batch {batch_index}") from exc
            total_rows += len(rows)

        # Checkpoint only after the insert is confirmed. Track every _id at the
        # last millisecond of this batch so a resume can skip exactly those.
        batch_last_ts = hits[-1]["sort"][0]
        if batch_last_ts == boundary_ts:
            boundary_ids.update(hit["_id"] for hit in hits if hit["sort"][0] == batch_last_ts)
        else:
            boundary_ts = batch_last_ts
            boundary_ids = set(hit["_id"] for hit in hits if hit["sort"][0] == batch_last_ts)
        save_checkpoint(boundary_ts, boundary_ids)

        elapsed = time.monotonic() - started
        rate = total_rows / elapsed if elapsed > 0 else 0
        LOG.info(
            "batch %d: inserted %d rows (total %d, %.0f rows/s)",
            batch_index,
            len(rows),
            total_rows,
            rate,
        )

    elapsed = time.monotonic() - started
    total_dropped = sum(dropped.values())

    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        LOG.info("removed checkpoint (migration complete)")

    LOG.info("migration complete: %d rows in %.1fs", total_rows, elapsed)
    if skipped:
        LOG.info("skipped documents: %s", dict(skipped))
    LOG.info("total dropped values (number/date/boolean cast failures): %d", total_dropped)
    if dropped:
        LOG.info("top %d most-dropped fields:", min(20, len(dropped)))
        for field_name, count in dropped.most_common(20):
            LOG.info("  %-40s %d", field_name, count)

    total_multivalue = sum(multivalue.values())
    LOG.info("multi-valued fields preserved in *_multiValues: %d", total_multivalue)
    if multivalue:
        LOG.info("top %d most multi-valued fields:", min(20, len(multivalue)))
        for field_name, count in multivalue.most_common(20):
            LOG.info("  %-40s %d", field_name, count)

    elasticsearch.close()
    clickhouse.close()


if __name__ == "__main__":
    main()
