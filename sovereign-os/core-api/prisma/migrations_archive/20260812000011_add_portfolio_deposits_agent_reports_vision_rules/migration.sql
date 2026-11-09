-- AI สอนลูก: ยอดฝากเงินจริงเข้าพอร์ต + เป้าหมายผลตอบแทนรายเดือน
ALTER TABLE kid_profiles ADD COLUMN invest_target_pct DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE TABLE kid_portfolio_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id UUID NOT NULL REFERENCES kid_profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kid_portfolio_deposits_kid ON kid_portfolio_deposits(kid_id, created_at);

-- Agentic AI: สรุปรายวันส่ง Telegram ต่อบทบาท
ALTER TABLE agent_roles ADD COLUMN daily_report BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agent_roles ADD COLUMN report_hour INTEGER NOT NULL DEFAULT 7;
ALTER TABLE agent_roles ADD COLUMN last_report_date TEXT;

-- Vision AI คนแปลกหน้า: ใบหน้าคุ้นเคย + กฎ + ประวัติแจ้งเตือน
CREATE TABLE known_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  photo_url TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vision_rules (
  id INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  interval_min INTEGER NOT NULL DEFAULT 10,
  notify_telegram BOOLEAN NOT NULL DEFAULT true,
  confidence_min DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  only_strangers BOOLEAN NOT NULL DEFAULT true,
  last_check_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vision_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT,
  message TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'stranger',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  cleared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vision_alerts_created ON vision_alerts(created_at);
