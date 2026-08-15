#!/usr/bin/env bash
# apply.tpartners.live 번들 → glovek 어드민 이관 (macOS: sqlite3 + curl 내장 사용)
#
# 사용법 (번들 압축 푼 폴더 = db/tiktok.db, uploads/ 있는 곳에서 실행):
#   export ADMIN_URL="https://admin.glovek.space"
#   export IMPORT_TOKEN="<CRON_SECRET 값>"
#   bash push-tpartners.sh --dry-run     # ① 매칭 리포트만(쓰기 없음)
#   bash push-tpartners.sh --rows        # ② 행 데이터 실제 이관(브랜드·회사정보)
#   bash push-tpartners.sh --files       # ③ uploads/ 파일 187개 이관(체크섬 검증)
#
# 경로 커스텀: DB=... UPLOADS=... 환경변수로 지정 가능.
set -euo pipefail

ADMIN_URL="${ADMIN_URL:-}"
IMPORT_TOKEN="${IMPORT_TOKEN:-}"
DB="${DB:-./db/tiktok.db}"
UPLOADS="${UPLOADS:-./uploads}"
MODE="${1:-}"

fail() { echo "❌ $*" >&2; exit 1; }
[ -n "$ADMIN_URL" ] || fail "ADMIN_URL 환경변수를 설정하세요 (예: https://admin.glovek.space)"
[ -n "$IMPORT_TOKEN" ] || fail "IMPORT_TOKEN 환경변수(CRON_SECRET 값)를 설정하세요"
command -v sqlite3 >/dev/null || fail "sqlite3 가 필요합니다 (macOS 기본 내장)"
command -v curl >/dev/null || fail "curl 이 필요합니다"

pretty() { if command -v python3 >/dev/null; then python3 -m json.tool 2>/dev/null || cat; else cat; fi; }

rows() {
  local dry="$1"
  [ -f "$DB" ] || fail "DB 파일이 없습니다: $DB (DB=경로 로 지정 가능)"
  echo "▶ 신청 행 이관 (dry_run=$dry) — $DB"
  local apps; apps=$(sqlite3 -json "$DB" 'SELECT * FROM tiktok_shop_applications;')
  [ -n "$apps" ] || apps="[]"
  printf '{"applications": %s}' "$apps" \
    | curl -sS -X POST "$ADMIN_URL/api/admin/import-tpartners?token=$IMPORT_TOKEN&dry_run=$dry" \
        -H 'content-type: application/json' --data-binary @- | pretty
}

files() {
  [ -d "$UPLOADS" ] || fail "uploads 디렉터리가 없습니다: $UPLOADS (UPLOADS=경로 로 지정 가능)"
  echo "▶ 파일 이관 — $UPLOADS"
  local total=0 ok=0 matched=0 skipped=0 failed=0
  for path in "$UPLOADS"/*; do
    [ -f "$path" ] || continue
    total=$((total+1))
    local fn sha resp
    fn=$(basename "$path")
    sha=$(shasum -a 256 "$path" | awk '{print $1}')
    resp=$(curl -sS -X POST "$ADMIN_URL/api/admin/import-file?token=$IMPORT_TOKEN" \
      -F "file=@$path" -F "filename=$fn" -F "sha256=$sha" || echo '{"ok":false,"error":"curl 실패"}')
    if echo "$resp" | grep -q '"matched":true'; then matched=$((matched+1)); ok=$((ok+1));
    elif echo "$resp" | grep -q '"matched":false'; then skipped=$((skipped+1)); ok=$((ok+1));
    else failed=$((failed+1)); echo "  ⚠ $fn → $resp"; fi
    printf "\r  진행: %d개 (매칭 %d · 미매칭 %d · 실패 %d)" "$total" "$matched" "$skipped" "$failed"
  done
  echo
  echo "✔ 완료: 총 $total · 저장 $matched · 미매칭 $skipped · 실패 $failed"
}

case "$MODE" in
  --dry-run) rows 1 ;;
  --rows)    rows 0 ;;
  --files)   files ;;
  *) echo "사용법: bash push-tpartners.sh [--dry-run | --rows | --files]"; exit 1 ;;
esac
