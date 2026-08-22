// 서버 액션 공통 에러 처리 — raw DB 에러를 사용자 친화 메시지로, 상세는 서버 로그로.
// 사용: catch (e) { return { ok: false, error: friendlyError(e, "제안서 저장") }; }

/** 원본 에러를 서버 로그에 남기고, 사용자에게 보여줄 안전한 한글 메시지를 반환. */
export function friendlyError(e: unknown, context = ""): string {
  const raw = e instanceof Error ? e.message : String(e);
  // 서버 로그에는 전체 원문(맥락 포함) — 관측성/디버깅용.
  console.error(`[action-error]${context ? ` ${context}:` : ""}`, raw);

  const m = raw.toLowerCase();
  // 스키마 드리프트: 마이그레이션 미적용 (accent2 사례) — 다음 행동까지 안내.
  if (m.includes("does not exist") && (m.includes("column") || m.includes("relation"))) {
    return "시스템 업데이트(DB)가 아직 반영되지 않았습니다. 설정 > DB 마이그레이션에서 ‘지금 적용’을 눌러 반영하거나 관리자에게 문의하세요.";
  }
  if (m.includes("duplicate key") || m.includes("unique constraint")) {
    return "이미 등록된 데이터입니다. 중복 여부를 확인해주세요.";
  }
  if (m.includes("foreign key") || m.includes("violates foreign key")) {
    return "연결된 데이터가 있어 처리할 수 없습니다. 관련 항목을 먼저 정리해주세요.";
  }
  if (m.includes("not-null") || m.includes("null value")) {
    return "필수 항목이 비어 있습니다. 입력값을 확인해주세요.";
  }
  if (m.includes("timeout") || m.includes("econnrefused") || m.includes("connection")) {
    return "일시적인 연결 오류입니다. 잠시 후 다시 시도해주세요.";
  }
  // 세션/권한 등 이미 사용자 친화적으로 던진 메시지는 그대로 노출(짧고 한글이면 통과).
  if (raw.length <= 60 && /[가-힣]/.test(raw)) return raw;
  return "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}
