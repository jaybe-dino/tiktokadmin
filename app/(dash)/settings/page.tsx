import ScreenHeader from "@/components/ScreenHeader";
import { AdminUserForm, RequirementsEditor, SlaPolicyEditor } from "@/components/SettingsForms";
import { currentUser } from "@/lib/auth";
import { adminUserList, slaPolicyList } from "@/lib/repo/queries";
import { listAllRequirements } from "@/lib/requirements";
import { DOC_TEMPLATES } from "@/lib/docs";
import { listMailboxes } from "@/lib/shared-mailboxes";
import MailboxManager from "@/components/MailboxManager";
import { getWelcomeConfig } from "@/lib/welcome";
import WelcomeConfigCard from "@/components/WelcomeConfig";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  viewer: "viewer",
  member: "담당",
  lead: "파트장",
  exec: "대표",
};

export default async function SettingsPage() {
  const user = (await currentUser())!;
  const canEdit = user.role === "lead" || user.role === "exec";
  const [policies, users, requirements, mailboxes, welcomeCfg] = await Promise.all([
    slaPolicyList().catch(() => []),
    adminUserList().catch(() => []),
    listAllRequirements().catch(() => []),
    listMailboxes().catch(() => []),
    getWelcomeConfig(),
  ]);

  const activeUsers = users.filter((u) => u.active).length;
  const activeReqs = requirements.filter((r) => r.active).length;

  return (
    <div className="max-w-6xl">
      <ScreenHeader
        title="설정·조직 — 계정 관리"
        desc={`담당자 ${users.length}명 · SLA 정책 ${policies.length}건 · 단계별 필수항목 ${activeReqs}건 활성`}
        right={
          !canEdit ? (
            <span className="chip chip-amb">읽기 전용 (편집은 파트장/대표만)</span>
          ) : undefined
        }
      />

      {/* 스탯 타일 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="tile">
          <div className="tile-k">담당자</div>
          <div className="tile-v">{users.length}</div>
        </div>
        <div className="tile">
          <div className="tile-k">활성 계정</div>
          <div className="tile-v">{activeUsers}</div>
        </div>
        <div className="tile">
          <div className="tile-k">SLA 정책</div>
          <div className="tile-v">{policies.length}</div>
        </div>
        <div className="tile">
          <div className="tile-k">필수항목(활성)</div>
          <div className="tile-v">{activeReqs}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        {/* 좌측 컬럼 */}
        <div className="grid gap-3.5 content-start">
          {/* 담당자 목록 */}
          <div className="card">
            <div className="card-hd">
              <b>계정 목록</b>
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                담당자 {users.length}명 · 활성 {activeUsers}
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="t">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>역할</th>
                    <th>Slack</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b>{u.name}</b>
                      </td>
                      <td>
                        <span className="sub" style={{ display: "inline" }}>
                          {u.id}
                        </span>
                      </td>
                      <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                      <td style={{ fontSize: 11, color: "var(--ink3)" }}>
                        {u.slack_user_id ?? "—"}
                      </td>
                      <td>
                        {u.active ? (
                          <span className="chip chip-grn">활성</span>
                        ) : (
                          <span className="chip chip-red">비활성</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: "var(--ink3)" }}>
                        등록된 담당자가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
                <AdminUserForm />
              </div>
            )}
            <div className="note" style={{ margin: "0 16px 14px" }}>
              연동(Slack·Zoom·Gmail)이 빠지면 그 사람만 자동화에서 조용히 빠집니다 — Zoom 없으면 미팅
              자동 배정 불가, Gmail 없으면 메일 타임라인 누락.
            </div>
          </div>

          {/* 회사 공용 메일함 */}
          <MailboxManager mailboxes={mailboxes} canEdit={canEdit} />

          {/* 신규 리드 자동 안내 */}
          <WelcomeConfigCard config={welcomeCfg} canEdit={canEdit} />

          {/* SLA 정책 */}
          <div className="card">
            <div className="card-hd">
              <b>SLA 정책 (영업일)</b>
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>변경은 파트장/대표만</span>
            </div>
            <div className="card-bd">
              {canEdit ? (
                <SlaPolicyEditor policies={policies} />
              ) : policies.length ? (
                <table className="t">
                  <thead>
                    <tr>
                      <th>대상</th>
                      <th>기준값</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policies.map((p) => (
                      <tr key={p.state}>
                        <td>
                          <span className={`pill st-${p.state}`}>{p.state}</span>
                        </td>
                        <td>
                          <b>{p.max_days}일</b>
                        </td>
                        <td style={{ color: "var(--ink3)" }}>{p.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="note">등록된 SLA 정책이 없습니다.</div>
              )}
            </div>
          </div>
        </div>

        {/* 우측 컬럼 */}
        <div className="grid gap-3.5 content-start">
          {/* 단계별 필수항목 */}
          <div className="card">
            <div className="card-hd">
              <b>단계별 필수항목</b>
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>
                단계 전환 게이트 기준 · 활성 {activeReqs}건
              </span>
            </div>
            <div className="card-bd">
              {canEdit ? (
                <RequirementsEditor requirements={requirements} />
              ) : requirements.filter((r) => r.active).length ? (
                <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                  {requirements
                    .filter((r) => r.active)
                    .map((r) => (
                      <div key={r.id}>
                        <span className={`pill st-${r.state}`}>{r.state}</span>{" "}
                        <span className="pill">{r.kind}</span> {r.label}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="note">등록된 필수항목이 없습니다.</div>
              )}
            </div>
          </div>

          {/* 서류 템플릿 */}
          <div className="card">
            <div className="card-hd">
              <b>서류 체크리스트 템플릿</b>
              <span style={{ color: "var(--ink3)", fontSize: 11 }}>계약형태별</span>
            </div>
            <div className="card-bd">
              {(["mall", "onboarding"] as const).map((t) => (
                <div className="row" key={t}>
                  <span className="ico">📑</span>
                  <div>
                    <div className="tt">
                      {t === "mall" ? "멀티몰" : "온보딩"} 템플릿
                      <span className="pill" style={{ marginLeft: 6 }}>
                        {DOC_TEMPLATES[t].length}종
                      </span>
                    </div>
                    <div className="ss">{DOC_TEMPLATES[t].map((i) => i.label).join(" · ")}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
