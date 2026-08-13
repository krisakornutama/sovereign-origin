-- AI สอนลูก: ระดับ/ดาว (XP) + เกียรติบัตร + พอร์ตย้อนหลัง + โหมดเงินจริง/นโยบายลงทุน
ALTER TABLE kid_profiles ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kid_profiles ADD COLUMN money_mode TEXT NOT NULL DEFAULT 'play';
ALTER TABLE kid_profiles ADD COLUMN invest_policy TEXT;

CREATE TABLE kid_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id UUID NOT NULL REFERENCES kid_profiles(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kid_certificates_kid ON kid_certificates(kid_id, created_at);

CREATE TABLE kid_portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kid_id UUID NOT NULL REFERENCES kid_profiles(id) ON DELETE CASCADE,
  value DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kid_portfolio_snapshots_kid ON kid_portfolio_snapshots(kid_id, created_at);

-- Agentic AI team: บทบาท + งานเบื้องหลัง
CREATE TABLE agent_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🤖',
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  capability TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES agent_roles(id) ON DELETE CASCADE,
  role_name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_agent_jobs_status ON agent_jobs(status, created_at);
