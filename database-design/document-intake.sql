-- Additive B evidence extension in C's SAME database; financial schema v1 is unchanged.
-- Source snapshots and companies must already exist. All writes use Store.transaction.
CREATE TABLE IF NOT EXISTS document_claims (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    snapshot_id VARCHAR NOT NULL,
    provider VARCHAR NOT NULL,
    claim_type VARCHAR NOT NULL,
    statement VARCHAR NOT NULL,
    raw_value VARCHAR,
    metric_key VARCHAR,
    verification_status VARCHAR NOT NULL CHECK (verification_status = 'needs_review'),
    payload JSON NOT NULL,
    FOREIGN KEY (deal_id, entity_key, snapshot_id, provider)
        REFERENCES source_snapshots(deal_id, entity_key, id, provider)
);
CREATE INDEX IF NOT EXISTS document_claims_deal ON document_claims(deal_id, claim_type);
