-- Acefire: embedded DuckDB, no hosted database account.
-- Schema version 1; generated from backend/app/db_schema.py.
-- Akta primary company data + private uploaded evidence.
-- Exact decimal strings; financial arithmetic uses Python Decimal.
-- Calculations link to input numbers, immutable files and native locators.
-- Fresh DuckDB baseline; init-db checks versions and repeat initialization.

BEGIN TRANSACTION;
CREATE TABLE deals (
    id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    historical_cutoff DATE
);

CREATE TABLE entities (
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    legal_name VARCHAR NOT NULL,
    domain VARCHAR NOT NULL,
    country VARCHAR NOT NULL,
    primary_provider VARCHAR NOT NULL CHECK (primary_provider = 'akta'),
    primary_company_id VARCHAR,
    PRIMARY KEY (deal_id, entity_key),
    FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE TABLE entity_identifiers (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    namespace VARCHAR NOT NULL,
    identifier VARCHAR NOT NULL,
    UNIQUE (deal_id, entity_key, namespace, identifier),
    FOREIGN KEY (deal_id, entity_key) REFERENCES entities(deal_id, entity_key)
);

CREATE TABLE source_snapshots (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    provider VARCHAR NOT NULL CHECK (provider IN ('orbis','pitchbook','akta','uploaded')),
    ingestion_channel VARCHAR NOT NULL,
    data_role VARCHAR NOT NULL,
    visibility VARCHAR NOT NULL CHECK (visibility = 'deal_private'),
    original_filename VARCHAR,
    uploaded_at TIMESTAMPTZ,
    source_kind VARCHAR NOT NULL,
    source_uri VARCHAR NOT NULL,
    sha256 VARCHAR NOT NULL CHECK (regexp_full_match(sha256, '[0-9a-f]{64}')),
    local_path VARCHAR,
    retrieved_at TIMESTAMPTZ,
    provider_as_of DATE,
    payload JSON NOT NULL,
    UNIQUE (deal_id, entity_key, id),
    UNIQUE (deal_id, entity_key, id, provider),
    UNIQUE (deal_id, entity_key, id, provider, data_role),
    UNIQUE (deal_id, entity_key, provider, source_uri, sha256),
    FOREIGN KEY (deal_id, entity_key) REFERENCES entities(deal_id, entity_key),
    CHECK (
      (ingestion_channel = 'provider_api' AND provider = 'akta' AND data_role = 'primary_company_data')
      OR (ingestion_channel = 'user_upload' AND data_role = 'supplemental_evidence')
    )
);

CREATE TABLE source_observations (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    snapshot_id VARCHAR NOT NULL,
    provider VARCHAR NOT NULL,
    metric_key VARCHAR NOT NULL,
    definition_key VARCHAR,
    raw_value VARCHAR,
    value VARCHAR,
    scale_multiplier VARCHAR,
    normalization_basis VARCHAR,
    currency VARCHAR,
    unit VARCHAR,
    scope VARCHAR,
    accounting_basis VARCHAR,
    scenario VARCHAR NOT NULL CHECK (scenario IN ('actual','forecast','unknown')),
    verification_status VARCHAR NOT NULL CHECK (verification_status IN ('source_located','manual_capture','api_reported','needs_review')),
    quarantined BOOLEAN NOT NULL,
    locator JSON NOT NULL,
    information_as_of DATE,
    normalization_status VARCHAR NOT NULL CHECK (normalization_status IN ('confirmed','unresolved','missing')),
    period_kind VARCHAR NOT NULL CHECK (period_kind IN ('instant','duration','unknown')),
    period_start DATE,
    period_end DATE,
    payload JSON NOT NULL,
    UNIQUE (deal_id, id),
    FOREIGN KEY (deal_id, entity_key, snapshot_id, provider)
      REFERENCES source_snapshots(deal_id, entity_key, id, provider),
    CHECK (normalization_status <> 'confirmed' OR (value IS NOT NULL AND unit IS NOT NULL))
);

CREATE TABLE company_profiles (
    snapshot_id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    provider VARCHAR NOT NULL,
    data_role VARCHAR NOT NULL DEFAULT 'primary_company_data',
    payload JSON NOT NULL,
    FOREIGN KEY (deal_id, entity_key, snapshot_id, provider, data_role)
      REFERENCES source_snapshots(deal_id, entity_key, id, provider, data_role),
    CHECK (provider = 'akta' AND data_role = 'primary_company_data')
);

CREATE TABLE calculations (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    metric_key VARCHAR NOT NULL,
    function_key VARCHAR NOT NULL,
    function_version VARCHAR NOT NULL,
    status VARCHAR NOT NULL CHECK (status IN ('succeeded','insufficient_data','not_applicable')),
    value VARCHAR,
    payload JSON NOT NULL,
    UNIQUE (deal_id, id),
    FOREIGN KEY (deal_id) REFERENCES deals(id),
    CHECK ((status = 'succeeded' AND value IS NOT NULL) OR (status <> 'succeeded' AND value IS NULL))
);

CREATE TABLE calculation_inputs (
    calculation_id VARCHAR NOT NULL,
    observation_id VARCHAR NOT NULL,
    deal_id VARCHAR NOT NULL,
    input_order INTEGER NOT NULL CHECK (input_order > 0),
    PRIMARY KEY (calculation_id, observation_id),
    UNIQUE (calculation_id, input_order),
    FOREIGN KEY (deal_id, calculation_id) REFERENCES calculations(deal_id, id),
    FOREIGN KEY (deal_id, observation_id) REFERENCES source_observations(deal_id, id)
);

CREATE TABLE comparisons (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    lhs_id VARCHAR NOT NULL,
    rhs_id VARCHAR NOT NULL,
    status VARCHAR NOT NULL CHECK (status IN ('matched','value_mismatch','not_comparable','insufficient_evidence')),
    delta VARCHAR,
    payload JSON NOT NULL,
    FOREIGN KEY (deal_id, lhs_id) REFERENCES source_observations(deal_id, id),
    FOREIGN KEY (deal_id, rhs_id) REFERENCES source_observations(deal_id, id),
    CHECK (lhs_id <> rhs_id),
    CHECK ((status IN ('matched','value_mismatch') AND delta IS NOT NULL)
      OR (status IN ('not_comparable','insufficient_evidence') AND delta IS NULL))
);

CREATE TABLE schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX observations_deal_metric ON source_observations(deal_id, metric_key, period_end);
INSERT INTO schema_versions VALUES (1, CURRENT_TIMESTAMP);
COMMIT;
