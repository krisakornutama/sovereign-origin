// ─────────────────────────────────────────────────────────────────────────────
// Facade — โค้ดแยกตาม domain ใน teach-kids-*.ts:
//   shared / lesson / profiles / chores / wallet / allowance / piggy / portfolio / summary / curriculum
// ไฟล์นี้รวม export ทั้งหมดไว้ที่ชื่อเดิม เพื่อให้ caller (routes / worker / tests) ใช้ได้เหมือนเดิม
// ─────────────────────────────────────────────────────────────────────────────

export { prisma, setNotifySender, logKidAction, kidAuditLog } from './teach-kids-shared';

export {
  OLLAMA_URL,
  OLLAMA_KEEP_ALIVE,
  TEACH_MODEL,
  AGE_RANGES,
  extractLessonJson,
  normalizeLesson,
  buildTeachPrompt,
  generateLesson,
  lessonToText,
  saveLesson,
  listOllamaModels,
} from './teach-kids-lesson';
export type { AgeRangeId, QuizQuestion, LessonSection, Lesson, TeachDeps, GenerateOptions } from './teach-kids-lesson';

export {
  createKid,
  updateKid,
  listKids,
  deleteKid,
  normalizeScore,
  kidLevel,
  xpForLevel,
  listCertificates,
  recordLessonProgress,
  kidStats,
} from './teach-kids-profiles';
export type { KidInput, KidProfile, KidStats } from './teach-kids-profiles';

export {
  addChore,
  deleteChore,
  completeChore,
  reopenChore,
  resetDailyChores,
  archiveOldItems,
} from './teach-kids-chores';
export type { ChoreInput } from './teach-kids-chores';

export {
  addBill,
  deleteBill,
  payBill,
  walletBalance,
  addWalletMoney,
  listWalletTxs,
  addCoupon,
  deleteCoupon,
  redeemCoupon,
} from './teach-kids-wallet';
export type { BillInput, CouponInput } from './teach-kids-wallet';

export {
  WEEKDAYS,
  setAllowance,
  allowanceDueNow,
  payWeeklyAllowances,
  payAllowanceNow,
  allowanceHistory,
} from './teach-kids-allowance';

export {
  piggyBalance,
  monthlyPiggyIn,
  setSavingsGoal,
  piggyTransfer,
  setKidPin,
  verifyKidPin,
  setPiggyTarget,
  piggyEta,
} from './teach-kids-piggy';

export {
  STOCK_CATALOG,
  stockPrice,
  stockPortfolio,
  buyStock,
  sellStock,
  recordPortfolioSnapshot,
  snapshotAllPortfolios,
  portfolioHistory,
  setKidMoneyMode,
  setInvestPolicy,
  setInvestTargetPct,
  addPortfolioDeposit,
  portfolioDeposits,
  portfolioPerformance,
} from './teach-kids-portfolio';
export type { StockSymbol } from './teach-kids-portfolio';

export {
  kidHome,
  dashboardSummary,
  weeklyReport,
  buildDailySummary,
  formatDailySummary,
} from './teach-kids-summary';
export type { DailySummaryRow } from './teach-kids-summary';

export {
  curriculumOverview,
  recordCurriculumProgress,
  subjectCertificates,
} from './teach-kids-curriculum';
export type { CurriculumOverview } from './teach-kids-curriculum';
