// build:static — Static export สำหรับ desktop shell (electron โหลด out/index.html ตรง)
// เดิม: next.config.js บังคับ output:'export' ตลอด → `next start` (production server) ใช้ไม่ได้เลย
// ตอนนี้: export เป็น opt-in ผ่าน SOVEREIGN_STATIC_EXPORT=1 (ดู next.config.js)
//   npm run build        → server build (ใช้กับ `next start`) → .next
//   npm run build:static → static export (ใช้กับ electron-builder) → out/
import { spawnSync } from 'node:child_process';

const env = { ...process.env, SOVEREIGN_STATIC_EXPORT: '1' };
const r = spawnSync('npx', ['next', 'build'], { stdio: 'inherit', shell: true, env });
process.exit(r.status ?? 1);
