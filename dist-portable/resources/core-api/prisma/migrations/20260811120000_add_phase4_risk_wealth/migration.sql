-- Phase 4: Risk & Wealth Infrastructure
-- ราคาหลักทรัพย์ (ไทม์ซีรีส์) — cron job ใน WealthService บันทึกทุก 1-4 ชม.
CREATE TABLE IF NOT EXISTS asset_prices (
  time      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol    TEXT NOT NULL,
  type      "AssetType" NOT NULL,
  price_usd DOUBLE PRECISION NOT NULL,
  source    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_prices_symbol_time ON asset_prices (symbol, time DESC);

-- เสบียงกายภาพ / สินค้าคงคลัง (ดีเซล, วัตถุดิบฟาร์ม, ทองคำแท่ง)
CREATE TABLE IF NOT EXISTS inventory_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'OTHER', -- FUEL | FOOD | MATERIAL | PRECIOUS_METAL | OTHER
  quantity       DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit           TEXT NOT NULL DEFAULT 'piece',
  unit_price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- หัวข้อข่าวจาก RSS — dedupe ด้วย link (unique)
CREATE TABLE IF NOT EXISTS risk_headlines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source     TEXT NOT NULL,
  title      TEXT NOT NULL,
  link       TEXT NOT NULL UNIQUE,
  summary    TEXT,
  published  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category   TEXT, -- war | banking | energy | inflation
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_headlines_published ON risk_headlines (published DESC);

-- Threat Index snapshot (0-100) — ผลวิเคราะห์จาก Ollama
CREATE TABLE IF NOT EXISTS threat_index (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  overall        DOUBLE PRECISION NOT NULL,
  categories     JSONB NOT NULL,
  summary        TEXT,
  model          TEXT NOT NULL,
  headline_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_threat_index_timestamp ON threat_index (timestamp DESC);

-- เหตุการณ์ DEFCON — audit trail ของทุก action
CREATE TABLE IF NOT EXISTS defcon_events (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level     INT NOT NULL, -- 3 | 2 | 1
  action    TEXT NOT NULL,
  detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_defcon_events_timestamp ON defcon_events (timestamp DESC);
