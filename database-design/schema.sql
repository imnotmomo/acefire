-- PostgreSQL schema DRAFT for the Enfuce evidence-workspace MVP.
-- This file has NOT been executed against PostgreSQL: no server/client is
-- installed in the inspected environment. Review before applying to a new DB.
-- No extensions are required. The Python application supplies all UUIDs.
-- One shared database serves both backends. Original file bytes stay in local
-- or object storage; only immutable revision metadata and evidence enter SQL.
-- Do not execute SQL/formulas supplied by an LLM or embedded in source files.

BEGIN;
CREATE SCHEMA diligence;
SET LOCAL search_path = diligence, pg_catalog;

CREATE TABLE deals (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    data_root_uri text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Group/reporting scope is distinct from any individual legal entity.
-- An entity label does not by itself prove consolidation perimeter or dates.
CREATE TABLE entities (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    entity_kind text NOT NULL CHECK (entity_kind IN ('group', 'legal_entity')),
    entity_key text NOT NULL,
    display_name text NOT NULL,
    legal_identifier text,
    scope_description text,
    parent_entity_id uuid,
    aliases jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(aliases) = 'array'),
    UNIQUE (deal_id, id),
    UNIQUE (deal_id, entity_key),
    FOREIGN KEY (deal_id, parent_entity_id) REFERENCES entities(deal_id, id),
    CHECK (parent_entity_id IS DISTINCT FROM id)
);

-- Append a new row for a changed physical file. Never overwrite old bytes.
-- Same bytes at different source paths remain distinct source references.
-- Enforce append-only revision handling in the application/storage layer.
CREATE TABLE files (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    relative_path text NOT NULL CHECK (
        length(relative_path) > 0
        AND relative_path !~ '^/'
        AND relative_path !~ '(^|/)\.\.(/|$)'
    ),
    storage_uri text NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    media_type text NOT NULL,
    category text,
    source_as_of_date date,
    previous_version_id uuid,
    imported_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, id),
    UNIQUE (deal_id, relative_path, sha256),
    FOREIGN KEY (deal_id, previous_version_id) REFERENCES files(deal_id, id),
    CHECK (previous_version_id IS DISTINCT FROM id)
);

CREATE TABLE processing_runs (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    file_id uuid NOT NULL,
    stage text NOT NULL CHECK (stage IN (
        'inspect', 'extract', 'normalize', 'verify_source'
    )),
    processor_name text NOT NULL,
    processor_version text NOT NULL,
    model_name text,
    prompt_sha256 text CHECK (
        prompt_sha256 IS NULL OR prompt_sha256 ~ '^[0-9a-f]{64}$'
    ),
    parameters jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(parameters) = 'object'),
    idempotency_key text NOT NULL,
    attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    status text NOT NULL CHECK (status IN (
        'pending', 'running', 'completed', 'partial', 'failed'
    )),
    started_at timestamptz,
    finished_at timestamptz,
    error_summary text,
    UNIQUE (deal_id, id),
    UNIQUE (deal_id, id, file_id),
    UNIQUE (deal_id, idempotency_key, attempt_number),
    FOREIGN KEY (deal_id, file_id) REFERENCES files(deal_id, id),
    CHECK (finished_at IS NULL OR started_at IS NOT NULL),
    CHECK (finished_at IS NULL OR finished_at >= started_at),
    CHECK (status <> 'failed' OR error_summary IS NOT NULL)
);

-- Locators use native, 1-based page/slide/paragraph numbers, not a printed
-- page label or an LLM guess. XLSX anchors retain exact sheet and cell address.
-- Examples: {"page":11,"bbox":[...]}, {"sheet":"PL","cell":"F9"},
-- {"slide":11,"table":1,"row":5,"column":4}, {"paragraph":56}.
-- Verify locator bounds against the immutable file before source_located.
CREATE TABLE evidence (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    file_id uuid NOT NULL,
    processing_run_id uuid,
    locator_kind text NOT NULL CHECK (locator_kind IN (
        'pdf_page', 'xlsx_cell', 'pptx_slide', 'docx_paragraph'
    )),
    locator_version integer NOT NULL DEFAULT 1 CHECK (locator_version > 0),
    locator jsonb NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
    quote text,
    raw_value text,
    numeric_value numeric,
    formula text,
    cached_numeric_value numeric,
    excel_number_format text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, id),
    FOREIGN KEY (deal_id, file_id) REFERENCES files(deal_id, id),
    FOREIGN KEY (deal_id, processing_run_id, file_id)
        REFERENCES processing_runs(deal_id, id, file_id),
    CHECK (quote IS NOT NULL OR raw_value IS NOT NULL),
    CHECK (numeric_value IS NULL OR numeric_value NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (cached_numeric_value IS NULL OR cached_numeric_value NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (
        CASE locator_kind
            WHEN 'pdf_page' THEN
                COALESCE((locator ->> 'page') ~ '^[1-9][0-9]*$', false)
            WHEN 'pptx_slide' THEN
                COALESCE((locator ->> 'slide') ~ '^[1-9][0-9]*$', false)
            WHEN 'docx_paragraph' THEN
                COALESCE((locator ->> 'paragraph') ~ '^[1-9][0-9]*$', false)
            WHEN 'xlsx_cell' THEN
                COALESCE(length(locator ->> 'sheet') > 0, false)
                AND COALESCE((locator ->> 'cell') ~ '^[A-Z]{1,3}[1-9][0-9]*$', false)
            ELSE false
        END
    )
);

-- Separate definitions prevent accidental comparison of Revenue/net sales
-- with total operating income, or cash balance with period revenue.
CREATE TABLE metric_definitions (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    metric_key text NOT NULL,
    definition_version integer NOT NULL CHECK (definition_version > 0),
    display_name text NOT NULL,
    definition text NOT NULL,
    canonical_unit text NOT NULL,
    aggregation_policy text NOT NULL DEFAULT 'not_defined' CHECK (
        aggregation_policy IN (
            'sum_flow', 'closing_balance', 'ratio', 'non_additive', 'not_defined'
        )
    ),
    UNIQUE (deal_id, id),
    UNIQUE (deal_id, metric_key, definition_version)
);

-- A claim can originate from either narrative or structured source material.
-- It is a reported observation, not an assertion that the business fact is true.
-- Preserve competing claims and versions; never UNIQUE(metric, period).
CREATE TABLE claims (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    subject_entity_id uuid,
    metric_definition_id uuid,
    statement_text text NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN (
        'narrative', 'structured', 'manual'
    )),
    value_kind text NOT NULL CHECK (value_kind IN ('numeric', 'text', 'missing')),
    raw_reported_text text,
    raw_numeric numeric,
    stored_unit text,
    display_unit text,
    display_divisor numeric CHECK (display_divisor > 0 AND display_divisor NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    normalization_state text NOT NULL DEFAULT 'unresolved' CHECK (
        normalization_state IN ('unresolved', 'confirmed')
    ),
    scale_multiplier numeric,
    -- Optional quantization AFTER scaling into canonical units. NULL preserves
    -- the exact scaled value; never default to 2 for ratios or other metrics.
    -- PostgreSQL numeric round() ties away from zero, matching Python Decimal
    -- with ROUND_HALF_UP. Preserve original XML text/value in evidence/raw fields.
    normalization_decimal_places integer CHECK (
        normalization_decimal_places BETWEEN 0 AND 18
    ),
    normalized_numeric numeric,
    normalization_basis text,
    -- Source display resolution in canonical units, distinct from the optional
    -- normalization precision above (e.g. a report rounded to whole kEUR).
    source_resolution numeric CHECK (source_resolution > 0 AND source_resolution NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    period_kind text NOT NULL DEFAULT 'unknown' CHECK (
        period_kind IN ('unknown', 'duration', 'instant')
    ),
    period_start date,
    period_end date,
    scenario text NOT NULL DEFAULT 'unknown' CHECK (
        scenario IN ('actual', 'forecast', 'budget', 'mixed', 'unknown')
    ),
    scenario_name text,
    extraction_state text NOT NULL DEFAULT 'needs_review' CHECK (
        extraction_state IN ('needs_review', 'source_located')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, id),
    FOREIGN KEY (deal_id, subject_entity_id) REFERENCES entities(deal_id, id),
    FOREIGN KEY (deal_id, metric_definition_id)
        REFERENCES metric_definitions(deal_id, id),
    CHECK (raw_numeric IS NULL OR raw_numeric NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (value_kind = 'numeric' OR raw_numeric IS NULL),
    CHECK (normalized_numeric IS NULL OR normalized_numeric NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (scale_multiplier IS NULL OR scale_multiplier NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (
        (normalization_state = 'unresolved'
            AND normalized_numeric IS NULL AND scale_multiplier IS NULL
            AND normalization_decimal_places IS NULL)
        OR
        (normalization_state = 'confirmed'
            AND value_kind = 'numeric' AND raw_numeric IS NOT NULL
            AND metric_definition_id IS NOT NULL AND stored_unit IS NOT NULL
            AND scale_multiplier IS NOT NULL AND scale_multiplier > 0
            AND normalized_numeric IS NOT NULL
            AND normalization_basis IS NOT NULL
            AND normalized_numeric = CASE
                WHEN normalization_decimal_places IS NULL
                    THEN raw_numeric * scale_multiplier
                ELSE round(raw_numeric * scale_multiplier, normalization_decimal_places)
            END)
    ),
    CHECK (
        (period_kind = 'unknown' AND period_start IS NULL AND period_end IS NULL)
        OR (period_kind = 'duration' AND period_start IS NOT NULL
            AND period_end IS NOT NULL AND period_end >= period_start)
        OR (period_kind = 'instant' AND period_start IS NULL AND period_end IS NOT NULL)
    )
);

CREATE TABLE claim_evidence (
    deal_id uuid NOT NULL REFERENCES deals(id),
    claim_id uuid NOT NULL,
    evidence_id uuid NOT NULL,
    relation text NOT NULL CHECK (relation IN (
        'reports', 'supports', 'qualifies', 'contradicts'
    )),
    PRIMARY KEY (deal_id, claim_id, evidence_id),
    FOREIGN KEY (deal_id, claim_id) REFERENCES claims(deal_id, id),
    FOREIGN KEY (deal_id, evidence_id) REFERENCES evidence(deal_id, id)
);

-- Functions are reviewed Python implementations identified by name/version.
-- formula_display is for explanation; it is not executable SQL/Python.
-- The application records missing inputs explicitly instead of treating them as0.
CREATE TABLE calculations (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    subject_entity_id uuid,
    metric_definition_id uuid NOT NULL,
    function_key text NOT NULL,
    function_version text NOT NULL,
    formula_display text NOT NULL,
    parameters jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(parameters) = 'object'),
    period_kind text NOT NULL CHECK (period_kind IN ('unknown', 'duration', 'instant')),
    period_start date,
    period_end date,
    scenario text NOT NULL CHECK (
        scenario IN ('actual', 'forecast', 'budget', 'mixed', 'unknown')
    ),
    scenario_name text,
    currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    input_complete boolean NOT NULL DEFAULT false,
    status text NOT NULL CHECK (
        status IN ('running', 'succeeded', 'missing_inputs', 'failed')
    ),
    result_numeric numeric,
    error_summary text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, id),
    FOREIGN KEY (deal_id, subject_entity_id) REFERENCES entities(deal_id, id),
    FOREIGN KEY (deal_id, metric_definition_id)
        REFERENCES metric_definitions(deal_id, id),
    CHECK (result_numeric IS NULL OR result_numeric NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (
        (status = 'succeeded' AND result_numeric IS NOT NULL AND input_complete
            AND subject_entity_id IS NOT NULL AND period_kind <> 'unknown'
            AND scenario NOT IN ('mixed', 'unknown'))
        OR (status <> 'succeeded' AND result_numeric IS NULL)
    ),
    CHECK (status NOT IN ('missing_inputs', 'failed') OR error_summary IS NOT NULL),
    CHECK (
        (period_kind = 'unknown' AND period_start IS NULL AND period_end IS NULL)
        OR (period_kind = 'duration' AND period_start IS NOT NULL
            AND period_end IS NOT NULL AND period_end >= period_start)
        OR (period_kind = 'instant' AND period_start IS NULL AND period_end IS NOT NULL)
    )
);

-- Inputs are normalized source observations with independent evidence links.
-- Do not double-count an annual total together with its component quarters.
-- Period coverage and aggregation policy are checked by the Python function.
CREATE TABLE calculation_inputs (
    deal_id uuid NOT NULL REFERENCES deals(id),
    calculation_id uuid NOT NULL,
    input_claim_id uuid NOT NULL,
    input_order integer NOT NULL CHECK (input_order > 0),
    input_role text NOT NULL,
    coefficient numeric NOT NULL DEFAULT 1 CHECK (coefficient NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    PRIMARY KEY (deal_id, calculation_id, input_claim_id),
    UNIQUE (deal_id, calculation_id, input_order),
    FOREIGN KEY (deal_id, calculation_id) REFERENCES calculations(deal_id, id),
    FOREIGN KEY (deal_id, input_claim_id) REFERENCES claims(deal_id, id)
);

-- Signed delta is RHS minus LHS in canonical units; relative_delta is NULL
-- when the LHS value is zero. A comparison never means "invest" or "pass".
-- No arbitrary default tolerance: record an explicit policy/resolution choice.
CREATE TABLE comparisons (
    id uuid PRIMARY KEY,
    deal_id uuid NOT NULL REFERENCES deals(id),
    lhs_claim_id uuid NOT NULL,
    rhs_claim_id uuid,
    rhs_calculation_id uuid,
    comparison_policy_version text NOT NULL,
    status text NOT NULL CHECK (status IN (
        'matched', 'value_mismatch', 'not_comparable', 'insufficient_evidence'
    )),
    reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(reason_codes) = 'array'),
    context_check jsonb NOT NULL CHECK (jsonb_typeof(context_check) = 'object'),
    tolerance_absolute numeric,
    delta numeric,
    relative_delta numeric,
    explanation text NOT NULL,
    compared_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, id),
    FOREIGN KEY (deal_id, lhs_claim_id) REFERENCES claims(deal_id, id),
    FOREIGN KEY (deal_id, rhs_claim_id) REFERENCES claims(deal_id, id),
    FOREIGN KEY (deal_id, rhs_calculation_id) REFERENCES calculations(deal_id, id),
    CHECK ((rhs_claim_id IS NOT NULL) <> (rhs_calculation_id IS NOT NULL)),
    CHECK (rhs_claim_id IS DISTINCT FROM lhs_claim_id),
    CHECK (tolerance_absolute IS NULL OR (
        tolerance_absolute >= 0 AND tolerance_absolute NOT IN (
            'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
        )
    )),
    CHECK (delta IS NULL OR delta NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (relative_delta IS NULL OR relative_delta NOT IN (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )),
    CHECK (
        (status = 'matched' AND delta IS NOT NULL
            AND tolerance_absolute IS NOT NULL AND abs(delta) <= tolerance_absolute)
        OR (status = 'value_mismatch' AND delta IS NOT NULL
            AND tolerance_absolute IS NOT NULL AND abs(delta) > tolerance_absolute)
        OR (status IN ('not_comparable', 'insufficient_evidence')
            AND delta IS NULL AND relative_delta IS NULL
            AND tolerance_absolute IS NULL AND jsonb_array_length(reason_codes) > 0)
    )
);

CREATE INDEX files_deal_sha_idx ON files (deal_id, sha256);
CREATE INDEX runs_file_stage_idx ON processing_runs (deal_id, file_id, stage, status);
CREATE INDEX evidence_file_locator_idx ON evidence (deal_id, file_id, locator_kind);
CREATE INDEX claims_metric_period_idx ON claims (
    deal_id, subject_entity_id, metric_definition_id, scenario, period_start, period_end
);
CREATE INDEX claim_evidence_reverse_idx ON claim_evidence (deal_id, evidence_id);
CREATE INDEX calculations_metric_period_idx ON calculations (
    deal_id, subject_entity_id, metric_definition_id, scenario, period_start, period_end
);
CREATE INDEX calculation_inputs_reverse_idx ON calculation_inputs (deal_id, input_claim_id);
CREATE INDEX comparisons_deal_status_idx ON comparisons (deal_id, status);
CREATE INDEX comparisons_lhs_idx ON comparisons (deal_id, lhs_claim_id);

-- REQUIRED SERVICE INVARIANTS (not enforceable by the above row CHECKs):
-- 1. A source_located claim has >=1 valid claim_evidence link; bounds/quotes are
--    verified against the immutable file and source revisions are append-only.
-- 2. Confirm unit interpretation per cell/segment. Excel '#,##0,' can display
--    raw EUR as kEUR: normalization scale=1, display divisor=1000. Adjacent
--    '#,##0' cells may themselves store kEUR: normalization scale=1000.
--    Do not derive canonical scale solely from a worksheet title or formatting.
-- 3. Before matched/value_mismatch, both sides have known, matching entity scope,
--    metric definition/version, period, scenario, canonical unit and currency;
--    numeric claims are confirmed and the RHS calculation succeeded. Missing
--    context yields not_comparable/insufficient_evidence, with NULL deltas.
-- 4. A completed calculation has all required normalized, source-located inputs;
--    its function checks aggregation, signs, non-overlapping periods and full
--    coverage. Cached Excel formula results are source observations, not proof
--    of a fresh recalculation. Never evaluate arbitrary workbook/LLM formulas.
-- 5. A zero denominator yields NULL relative_delta, not 0. Persist arithmetic,
--    chosen absolute tolerance, resolution rationale and version in the audit.
-- 6. No implicit FX conversion, forecast/actual comparison or group/entity sum.
--    Explicit conversions/adjustments require their own sourced calculations.

COMMIT;
