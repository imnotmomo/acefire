-- Append-only report snapshots in the same C database; financial schema unchanged.
CREATE TABLE IF NOT EXISTS narrative_reports (
    id VARCHAR PRIMARY KEY,
    deal_id VARCHAR NOT NULL,
    entity_key VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    payload JSON NOT NULL,
    FOREIGN KEY (deal_id, entity_key) REFERENCES entities(deal_id, entity_key)
);
CREATE INDEX IF NOT EXISTS narrative_deal_created ON narrative_reports(deal_id, created_at);
