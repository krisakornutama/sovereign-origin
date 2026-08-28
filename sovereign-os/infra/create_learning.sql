CREATE TABLE IF NOT EXISTS learning_snapshots (
  id UUID PRIMARY KEY,
  "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  domain TEXT NOT NULL,
  features JSONB NOT NULL,
  label JSONB,
  source TEXT DEFAULT 'auto',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS learning_snapshots_domain_capturedAt_idx ON learning_snapshots(domain, "capturedAt");
CREATE INDEX IF NOT EXISTS learning_snapshots_capturedAt_idx ON learning_snapshots("capturedAt");
SELECT create_hypertable('learning_snapshots', 'capturedAt', if_not_exists => TRUE, migrate_data => TRUE);

CREATE TABLE IF NOT EXISTS learning_predictions (
  id UUID PRIMARY KEY,
  "snapshotId" UUID REFERENCES learning_snapshots(id) ON DELETE SET NULL,
  domain TEXT NOT NULL,
  model TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB NOT NULL,
  confidence DOUBLE PRECISION,
  actual JSONB,
  correct BOOLEAN,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "evaluatedAt" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS learning_predictions_domain_createdAt_idx ON learning_predictions(domain, "createdAt");
CREATE INDEX IF NOT EXISTS learning_predictions_model_idx ON learning_predictions(model);

CREATE TABLE IF NOT EXISTS learning_model_states (
  id UUID PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  model TEXT NOT NULL,
  accuracy DOUBLE PRECISION,
  "trainedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prompt TEXT,
  stats JSONB
);
