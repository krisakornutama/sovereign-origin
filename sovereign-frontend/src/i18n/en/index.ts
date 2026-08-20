// ─────────────────────────────────────────────────────────────
//  en — รวมพจนานุกรมภาษาอังกฤษ (common + หน้าแต่ละหน้า)
//  หน้าใหม่: สร้าง src/i18n/en/pages/<ns>.ts แล้วเพิ่ม import ที่นี่
// ─────────────────────────────────────────────────────────────
import { common } from './common';
import app from './app';
import ai from './pages/ai';
import aiAgent from './pages/aiAgent';
import alerts from './pages/alerts';
import audit from './pages/audit';
import automation from './pages/automation';
import backup from './pages/backup';
import changePassword from './pages/changePassword';
import dashboard from './pages/dashboard';
import energy from './pages/energy';
import farm from './pages/farm';
import governanceSim from './pages/governanceSim';
import healing from './pages/healing';
import health from './pages/health';
import healthExport from './pages/healthExport';
import history from './pages/history';
import infrastructure from './pages/infrastructure';
import inventory from './pages/inventory';
import knowledge from './pages/knowledge';
import lifestyle from './pages/lifestyle';
import { livestock } from './pages/livestock';
import login from './pages/login';
import ota from './pages/ota';
import portfolio from './pages/portfolio';
import predictive from './pages/predictive';
import property from './pages/property';
import relay from './pages/relay';
import reports from './pages/reports';
import riskMonitor from './pages/riskMonitor';
import scenarioForecast from './pages/scenarioForecast';
import security from './pages/security';
import securityComponents from './pages/securityComponents';
import sensorsHub from './pages/sensorsHub';
import settings from './pages/settings';
import system from './pages/system';
import { treasury } from './pages/treasury';
import users from './pages/users';
import vision from './pages/vision';

export default {
  common,
  app,
  ai,
  aiAgent,
  alerts,
  audit,
  automation,
  backup,
  changePassword,
  dashboard,
  energy,
  farm,
  governanceSim,
  healing,
  health,
  healthExport,
  history,
  infrastructure,
  inventory,
  knowledge,
  lifestyle,
  livestock,
  login,
  ota,
  portfolio,
  predictive,
  property,
  relay,
  reports,
  riskMonitor,
  scenarioForecast,
  security,
  securityComponents,
  sensorsHub,
settings,
  system,
  treasury,
  users,
  vision,
} as const;
