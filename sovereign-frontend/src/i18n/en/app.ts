// App (_app.tsx NoAccessScreen, ApiConnectionBanner, AgentBackgroundBadge) — English
export default {
  noAccessTitle: 'This page has not been opened for you yet',
  noAccessHint: 'If you think you should see this page, ask an administrator (superadmin) to grant access on the Users page',
  backDashboard: 'Back to Dashboard',
  banner: {
    connecting: 'Reconnecting…',
    connectingDetail: ' (attempt {n}) — the API is not responding; the system will retry automatically every few seconds',
    retryNow: 'Try now',
    reconnected: 'API connected',
    reconnectedDetail: ' — loading data automatically…',
  },
  badge: {
    notifStartedTitle: '🤖 AI is working in the background',
    notifStartedBody: '{n} job(s) running — feel free to browse other pages',
    notifDoneTitle: '✅ Background AI work finished',
    notifDoneBody: 'Finished {n} job(s) — see results on the AI Agent page',
    tooltip: 'AI is working in the background — click to view status',
    label: 'AI working in the background ({n})',
  },
} as const;