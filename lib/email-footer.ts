// 발송 메일 공용 푸터(서명) — 모든 아웃바운드 메일 하단에 회사 정보 통일 부착.
//   구 서명(글로브케이/목표/glovek.space)이 본문에 있으면 제거 후 신규 푸터로 교체.

export const EMAIL_FOOTER = [
  "--",
  "No.1 tiktokshop partners Glovek https://glovek.space",
  "Seoul HQ Office : 서울특별시 서초구 사임당로 26, 8층 802호",
  "Thailand : 88/171 - 2, Moo 15, Bang Sao Tong Subdistrict, Bang Sao Tong District, Samutprakarn 10570",
  "Vietnam : Lane 129, Duong Duc Hien Street, To Khe Village, Thuan An Commune, Hanoi",
  "USA : 1001 W Middlesex Ave, Port Reading, NJ 07064",
].join("\n");

/**
 * 본문에 회사 푸터를 부착. 멱등(이미 신규 푸터 있으면 그대로).
 *   본문에 구 서명 블록(-- 뒤 글로브케이/목표/glovek.space)이 있으면 제거 후 교체.
 */
export function appendFooter(body: string): string {
  let out = body ?? "";
  // 구 서명 블록 제거 — "--" 구분선부터 글로브케이/목표/glovek.space 포함 블록.
  out = out.replace(/\n*-{2,}\s*\n[\s\S]*?글로브케이[\s\S]*?glovek\.space\s*(?:<[^>]*>)?/gi, "");
  // 잔여 구서명 라인 개별 제거(구분선 유무·순서 무관).
  out = out
    .replace(/^\s*글로브케이\s*$/gm, "")
    .replace(/^\s*목표\s*$/gm, "")
    .replace(/^\s*https?:\/\/glovek\.space\s*<[^>]*>\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  // 이미 신규 푸터가 있으면 중복 부착 안 함.
  if (out.includes("No.1 tiktokshop partners Glovek")) return out;
  return `${out}\n\n${EMAIL_FOOTER}`;
}
