CREATE TABLE IF NOT EXISTS entity_history_test
(
    `@timestamp`        DateTime64(3),
    id_client           LowCardinality(String),
    id_entityType       LowCardinality(String),
    id_reference        String,
    changedFields       Array(String),

    data_textFields      Map(String, String),
    data_numberFields    Map(String, Float64),
    data_dateFields      Map(String, DateTime64(3)),
    data_booleanFields   Map(String, UInt8),
    data_multiValues     Map(String, Array(String)),

    prev_textFields      Map(String, String),
    prev_numberFields    Map(String, Float64),
    prev_dateFields      Map(String, DateTime64(3)),
    prev_booleanFields   Map(String, UInt8),
    prev_multiValues     Map(String, Array(String)),

    meta_createdBy       LowCardinality(String),
    meta_updatedBy       LowCardinality(String),
    meta_updatedSource   LowCardinality(String),
    meta_shortId         String,
    meta_correlationId   String,
    meta_createdTime     Int64,
    meta_updateTime      Int64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(`@timestamp`)
ORDER BY (id_client, id_entityType, id_reference, `@timestamp`)
