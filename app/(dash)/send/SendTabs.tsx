"use client";
import { useState } from "react";
import SmsSender from "@/components/SmsSender";

type Row = Record<string, unknown>;

const CH: Record<string, string> = { email: "✉️ 메일", sms: "📱 문자", both: "메일+문자" };
const TK: Record<string, string> = { lead_group: "리드 그룹", filter: "필터 조합", manual: "직접 선택" };
const ST: Record<string, { ko: string; c: string }> = {
  draft: { ko: "작성중", c: "cc-warn" },
  queued: { ko: "대기", c: "cc-ing" },
  sending: { ko: "발송중", c: "cc-ing" },
  done: { ko: "완료", c: "cc-ok" },
  canceled: { ko: "취소", c: "cc-no" },
};

function fmt(v: unknown): string {
  const s = String(v ?? "");
  return s ? s.slice(0, 16).replace("T", " ") : "-";
}

export default function SendTabs({ sends }: { sends: Row[] }) {
  const [tab, setTab] = useState<"mail" | "sms" | "log">("mail");

  return (
    <div>
      <div className="tabbar mb-4">
        <button className={tab === "mail" ? "on" : ""} onClick={() => setTab("mail")}>
          ✉️ 메일 발송
        </button>
        <button className={tab === "sms" ? "on" : ""} onClick={() => setTab("sms")}>
          📱 문자 발송
        </button>
        <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>
          발송 관리 · 채널 정책
        </button>
      </div>

      {tab === "mail" && <MailTab />}
      {tab === "sms" && <SmsTab />}
      {tab === "log" && <LogTab sends={sends} />}
    </div>
  );
}

/* ───────────── 탭1 · 메일 ───────────── */
function MailTab() {
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="card">
        <div className="card-hd">
          <b>대량 메일</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>대상 → 작성 → 검토·발송</span>
        </div>
        <div className="card-bd">
          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 1 · 대상 그룹</b>
          <div className="radio sel" style={{ marginTop: 8 }}>
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>리드 등록 날짜 그룹</b>
              <select className="f" style={{ marginTop: 6 }}>
                <option>리드 그룹 선택</option>
              </select>
            </div>
          </div>
          <div className="radio">
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>필터 조합</b>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className="chip">상태: 리드·세미나 ✕</span>
                <span className="chip">마지막 접촉 30일+ ✕</span>
                <button className="btn btn-sm">+ 필터</button>
              </div>
            </div>
          </div>
          <div className="radio">
            <span className="rb" />
            <div>
              <b>직접 선택</b>{" "}
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>검색·체크 / 목록 붙여넣기</span>
            </div>
          </div>
          <div className="note" style={{ margin: "8px 0 14px" }}>
            대상 선택 시 <b style={{ color: "var(--ok)" }}>수신동의 보유 대상만</b> 자동 필터 · 거부·연락처
            없음 <b style={{ color: "var(--danger)" }}>자동 제외</b>
          </div>

          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 2 · 메일 작성</b>
          <label className="f">발신 계정 (회사 이메일만 — 개인 메일 사용 불가)</label>
          <select className="f">
            <option>영업팀 대표 &lt;sales@dinostudio.kr&gt;</option>
            <option>마케팅 &lt;marketing@dinostudio.kr&gt;</option>
          </select>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <select className="f">
              <option>템플릿: 박람회 환영 + 세미나 초대</option>
              <option>템플릿: 미팅 예약 안내</option>
              <option>빈 문서</option>
            </select>
            <button className="btn btn-sm" style={{ whiteSpace: "nowrap" }}>
              AI 초안 생성
            </button>
          </div>
          <input className="f" style={{ marginTop: 6 }} placeholder="제목 — 예: [GloveK] {브랜드명}님, 반가웠습니다" />
          <textarea
            className="f"
            rows={3}
            style={{ marginTop: 6 }}
            placeholder="{담당자명}님, ... 개인화 변수를 활용해 본문을 작성하세요."
          />
          <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>
            개인화 변수: {"{브랜드명} {담당자명} {담당자예약링크} {설문링크}"} · 회신은 발신 계정으로
            수신 → 시스템이 전량 수집해 카드에 연결
          </div>

          <hr className="hr" />
          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 3 · 검토·발송</b>
          <div className="kv" style={{ marginTop: 8, fontSize: 12 }}>
            <dt>발송 시각</dt>
            <dd>즉시 / 예약</dd>
            <dt>발송 후</dt>
            <dd style={{ color: "var(--ok)" }}>전원 고객카드 히스토리에 컨택 기록 + 방치 알림 리셋</dd>
          </div>
          <div className="note" style={{ marginTop: 12 }}>
            대량 메일 발송 실행은 아직 미구현입니다. 폼 UI만 제공하며, 실제 발송 연동은 준비 중입니다.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} disabled>
              테스트 발송 (나에게)
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} disabled>
              대량 발송 실행
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <div className="card">
          <div className="card-hd">
            <b>개별 메일</b>
            <span style={{ color: "var(--ink3)", fontSize: 11 }}>고객카드에서도 [✉️ 메일]로 호출</span>
          </div>
          <div className="card-bd">
            <select className="f">
              <option>브랜드 · 담당자 선택</option>
            </select>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 8 }} disabled>
              ✉️ 개별 메일 작성
            </button>
            <div className="note" style={{ marginTop: 8 }}>
              모달에서 작성 — AI가 카드 맥락(단계·최근 미팅)으로 초안 · 발송 즉시 카드 히스토리 기록
              (준비 중)
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <b>그룹 목록</b>
          </div>
          <div className="card-bd" style={{ paddingTop: 6, fontSize: 12 }}>
            <div className="note">리드 그룹 데이터가 없습니다.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 탭2 · 문자 ───────────── */
function SmsTab() {
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="card">
        <div className="card-hd">
          <b>대량 문자</b>
          <span style={{ color: "var(--ink3)", fontSize: 11 }}>알림톡 우선 · 실패 시 SMS 폴백</span>
        </div>
        <div className="card-bd">
          <b style={{ fontSize: 12, color: "var(--acc)" }}>STEP 1 · 대상 그룹</b>
          <div className="radio sel" style={{ marginTop: 8 }}>
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>리드 등록 날짜 그룹</b>
              <select className="f" style={{ marginTop: 6 }}>
                <option>리드 그룹 선택</option>
              </select>
            </div>
          </div>
          <div className="radio">
            <span className="rb" />
            <div style={{ flex: 1 }}>
              <b>필터 조합</b>{" "}
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>— 메일 탭과 동일 필터</span>
            </div>
          </div>
          <div className="radio">
            <span className="rb" />
            <div>
              <b>직접 선택</b>
            </div>
          </div>
          <div className="note" style={{ margin: "8px 0 14px" }}>
            대상 중 번호 보유·수신동의 <b style={{ color: "var(--ok)" }}>대상만 발송</b> · 미보유 자동
            제외
          </div>
          <div className="note">
            대량 문자 발송 실행은 아직 미구현입니다. 개별 문자 발송은 오른쪽 위젯을 사용하세요.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <div className="card">
          <div className="card-hd">
            <b>개별 문자</b>
            <span style={{ color: "var(--ink3)", fontSize: 11 }}>Aligo · 발신 지정 번호 고정</span>
          </div>
          <div className="card-bd">
            <SmsSender />
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <b>문자 회신 인박스</b>
          </div>
          <div className="card-bd" style={{ paddingTop: 6, fontSize: 12 }}>
            <div className="note">수신된 문자 회신이 없습니다.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── 탭3 · 발송 관리·채널 정책 ───────────── */
function LogTab({ sends }: { sends: Row[] }) {
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="card">
        <div className="card-hd">
          <b>통합 발송 관리 — 메일·문자 전체</b>
        </div>
        <div className="overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>일시</th>
                <th>채널</th>
                <th>구분</th>
                <th>제목/템플릿</th>
                <th>대상</th>
                <th>진행</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {sends.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink3)" }}>
                    발송 이력이 없습니다.
                  </td>
                </tr>
              )}
              {sends.map((s) => {
                const st = ST[String(s.status)] ?? { ko: String(s.status ?? "-"), c: "cc-no" };
                return (
                  <tr key={String(s.id)}>
                    <td>{fmt(s.created_at)}</td>
                    <td>{CH[String(s.channel)] ?? String(s.channel ?? "-")}</td>
                    <td>{TK[String(s.target_kind)] ?? String(s.target_kind ?? "-")}</td>
                    <td className="font-semibold">{String(s.title ?? "-")}</td>
                    <td style={{ color: "var(--ink3)" }}>{Number(s.total ?? 0)}</td>
                    <td style={{ color: "var(--ink3)" }}>
                      {Number(s.sent ?? 0)}/{Number(s.total ?? 0)}
                    </td>
                    <td>
                      <span className={`cellchip ${st.c}`}>{st.ko}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 16px" }} className="note">
          모든 행의 발송 결과는 대상 브랜드의 <b>360 타임라인에 컨택 기록으로 등재</b>됩니다 —
          발송·오픈·회신이 고객 히스토리로 남습니다.
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
        <div className="card" style={{ borderColor: "#fca5a5" }}>
          <div className="card-hd">
            <b>발신 채널 정책 (전 직원)</b>
          </div>
          <div className="card-bd" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
            ① 메일은 <b>회사 이메일(@dinostudio.kr)로만</b> 발신 — 개인 메일 사용 금지
            <br />② 문자는 <b>회사 지정 번호로만</b> — 개인 휴대폰으로 고객 연락 금지
            <br />③ 회사 채널의 <b>수신·발신 전량을 시스템이 수집</b>해 고객카드에 연결 — 개인 채널을
            쓰면 기록이 누락되고 방치 알림이 오작동
            <br />④ 위반 시 기록 공백은 담당자 책임 — 반드시 발송 센터/카드 모달로만 발송
          </div>
        </div>
        <div className="card">
          <div className="card-hd">
            <b>수집 연동 상태</b>
          </div>
          <div className="card-bd" style={{ fontSize: 12 }}>
            <div className="row">
              <span className="ico i-grn">✉️</span>
              <div>
                <div className="tt">회사 이메일 수집 (도메인 위임)</div>
                <div className="ss">@dinostudio.kr 전 계정</div>
              </div>
              <div className="rt">
                <span className="chip grn">정상</span>
              </div>
            </div>
            <div className="row">
              <span className="ico i-grn">📱</span>
              <div>
                <div className="tt">지정 번호 수신 (게이트웨이)</div>
                <div className="ss">1533-06xx 회신 웹훅</div>
              </div>
              <div className="rt">
                <span className="chip grn">정상</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
