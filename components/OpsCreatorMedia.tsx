"use client";
// 운영 제안서 공개 페이지 크리에이터 썸네일 — 마케팅 데크와 동일한 로드 정책:
//   no-referrer 로드(틱톡 CDN Referer 차단 회피) + 실패 시 액박 대신 @핸들 placeholder 전환 +
//   링크 있으면 클릭 시 콘텐츠 원본(틱톡) 이동(▶ 배지).
import { useState } from "react";

export default function OpsCreatorMedia({ thumb, link, handle }: { thumb?: string | null; link?: string | null; handle?: string }) {
  const [broken, setBroken] = useState(false);
  const media = thumb && !broken
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={thumb} alt={handle ?? ""} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
    : <div className="pp-cr-ph" style={{ display: "grid", placeItems: "center", color: "#b78ba0", fontSize: 13, fontWeight: 800 }}>{handle || "@creator"}</div>;
  return link ? (
    <a className="pp-cr-media" href={link} target="_blank" rel="noreferrer" style={{ display: "block" }} title="콘텐츠 원본 보기">
      {media}
      <span className="pp-cr-play">▶</span>
    </a>
  ) : (
    <div className="pp-cr-media">
      {media}
      {thumb && !broken ? <span className="pp-cr-play">▶</span> : null}
    </div>
  );
}
