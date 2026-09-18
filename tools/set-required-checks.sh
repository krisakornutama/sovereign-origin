#!/usr/bin/env bash
# ตั้ง required status checks ทรัพยากร 3 เป็น gate ของ main — ใช้เมื่อแพลนรองรับ (GitHub Pro / repo public)
# ใช้: bash tools/set-required-checks.sh          # dry-run ดูสิ่งที่จะตั้ง + ทดสอบสิทธิ์
#      bash tools/set-required-checks.sh --apply # ตั้งจริง (Branch protection API)
# ผ่านการทดสอบ dry-run แล้วเมื่อ 2026-09-17 (apply โดน 403 เพราะ private repo บนแพลนฟรี — ตามคาด)
set -euo pipefail
REPO="${REPO:-krisakornutama/sovereign-origin}"
CONTEXTS=(
  "Audit site / audit"
  "File size guard / size"
  "Deploy portfolio / publish"
  "Core API tests / test (ubuntu-latest)"
  "Core API tests / test (windows-latest)"
  "Core API tests / test-db"
)

# 1) สิทธิ์: repo ส่วนตัวฟรีจะ 403 ที่นี่ — สคริปต์บอกทางออกตรง ๆ ไม่เดา
if ! gh api "repos/$REPO/rulesets" --jq 'length' >/dev/null 2>&1; then
  echo "✗ แพลนปัจจุบันไม่รองรับ rulesets/branch protection บน private repo (HTTP 403)"
  echo "  ทางเลือก: อัปเกรด GitHub Pro หรือเปลี่ยน repo เป็น public แล้วรันอีกครั้งด้วย --apply"
  exit 2
fi

# 2) ตั้งจริงผ่าน Branch protection API (ต้อง admin)
if [ "${1:-}" = "--apply" ]; then
  # สร้าง args เป็น array — context มีช่องว่าง ห้ามผ่าน printf แล้วให้ shell แตกคำ
  # -F (typed) กับ strict เพื่อให้เป็น boolean จริง — -f จะส่งสตริง "true" แล้ว GitHub ตอบ 422
  ARGS=(-F "required_status_checks[strict]=true")
  for c in "${CONTEXTS[@]}"; do
    ARGS+=(-f "required_status_checks[contexts][]=$c")
  done
  gh api -X PUT "repos/$REPO/branches/main/protection" "${ARGS[@]}" \
    -F "enforce_admins=false" \
    -F "required_pull_request_reviews=null" \
    -F "restrictions=null"
  echo "✓ ตั้ง required checks แล้ว: ${CONTEXTS[*]}"
  gh api "repos/$REPO/branches/main/protection" --jq '.required_status_checks.contexts'
else
  echo "dry-run — จะตั้ง required checks บน main ของ $REPO:"
  printf '  - %s\n' "${CONTEXTS[@]}"
  echo "รันอีกครั้งด้วย --apply เพื่อตั้งจริง (ต้องแพลนรองรับก่อน)"
fi
