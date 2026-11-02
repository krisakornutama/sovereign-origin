// Ecosystem page + Social Studio post history — English
export default {
  // ── Ecosystem page (ecosystem.tsx) ──
  loadError: 'Failed to load Ecosystem data',
  revealError: 'Failed to reveal password',
  copied: 'Password copied — paste it now',
  copyError: 'Copy failed',
  badUrl: 'Invalid URL — must be http/https',
  openError: 'Failed to open website',

  // ── Social Studio modes ──
  socialStudio: {
    text: 'Post text',
    subText: 'General posts · promotions · work updates → Facebook',
    clip: 'Post video clip',
    subClip: 'YouTube · Instagram · TikTok · Facebook',
    history: 'Post history',
    historySub: 'Track which platforms you posted to — avoid duplicates',
    historyBadge: 'Stored in database',
    badgeFb: '{n} Facebook account(s)',
    badgeFbNone: 'No Facebook account yet',
    badgeClip: '{n} account(s) ready',
    badgeClipNone: 'No social account yet',
  },

  // ── TextStudio ──
  textStudio: {
    saveHistory: 'Save this job to history',
    saving: 'Saving…',
    saved: 'Saved to history — see “Post history” tab',
  },

  // ── ClipStudio ──
  clipStudio: {
    saveHistory: 'Save this job to history',
    saving: 'Saving…',
    saved: 'Saved to history — see “Post history” tab',
  },

  // ── PostHistory ──
  postHistory: {
    title: 'Post history',
    subtitle: 'Stored in database — syncs across devices, not lost when clearing browser',
    refresh: 'Refresh',
    loading: 'Loading…',
    loadingHistory: 'Loading history…',
    deleting: 'Deleting…',
    loadError: 'Failed to load history',
    updateError: 'Failed to update status',
    deleteError: 'Failed to delete history',
    badUrl: 'Post link must start with http:// or https://',
    noHistory: 'No post history yet',
    noHistorySub:
      'Go to “Post text” or “Post video clip” tab, then tap “Save this job to history” to track which platforms you posted to',
    confirmDelete: 'Delete this history record permanently? Deleting does not affect the actual post on the platform',
    deleted: 'History record deleted',
    msgPosted: 'Marked {label} as posted',
    msgSkipped: 'Marked {label} as skipped',
    msgPending: 'Set {label} back to pending',
    textPost: 'Text post',
    clipPost: 'Video clip job',
    postedAt: 'at',
    openLink: 'Open post link',
    linkPlaceholder: 'Post link (optional)',
    markPosted: 'Mark as posted',
    markSkipped: 'Mark as skipped',
    markPending: 'Set back to pending',
    saving: 'Saving…',
    hint:
      '“Posted” here is just an app record — it does not confirm the platform. Tap only after you actually posted. Deleting this history does not delete the post on the platform',
    platform: {
      youtube: 'YouTube',
      facebook: 'Facebook',
      instagram: 'Instagram',
      tiktok: 'TikTok',
    },
    status: {
      pending: 'Pending',
      posted: 'Posted',
      skipped: 'Skipped',
    },
    actions: {
      save: 'Save',
      delete: 'Delete',
      refresh: 'Refresh',
    },
  },
} as const;
