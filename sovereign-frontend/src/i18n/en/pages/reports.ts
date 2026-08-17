// Reports page (reports.tsx) — English
export default {
  unauthorized: 'Unauthorized',
  eyebrow: 'Data & Reports',
  backDashboard: '← Back to Dashboard',
  generating: 'Generating…',
  generateDaily: 'Generate today\u2019s report',
  generateWeekly: 'Generate weekly report',
  created: 'Report created: {title}',
  loadError: 'Failed to load reports — make sure the backend is running and the latest migration was applied',
  generateError: 'Failed to generate report — make sure Ollama is running and TimescaleDB has data',
  automationNote: 'Automatic reports: every morning 06:00 (daily) and Sunday 07:00 (weekly) — summarized by AI from TimescaleDB data and sent to Telegram',
  noReports: 'No reports yet — click the buttons above to create the first one',
  weekly: 'Weekly',
  daily: 'Daily',
} as const;