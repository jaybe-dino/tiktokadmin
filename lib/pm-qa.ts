// PM 운영 검수용 합성 데이터 — 실제 고객을 건드리지 않고 UI 를 확인하기 위한 경로.
//   안전 규칙:
//     · 만드는 브랜드는 반드시 is_test=true 이고 이메일·전화가 없다(실발송 대상이 될 수 없다).
//     · 상태는 'dropped' 로 만든다 — 기존 백그라운드 작업(lib/sla.ts · lib/agents.ts 등)이
//       state NOT IN ('dropped','churned') 로 걸러내므로 SLA·일일 운영 점검·사전분석·
//       고객 보고 집계에 섞이지 않는다. is_test 만으로는 걸러지지 않는 경로가 있다.
//     · 기존 운영 브랜드는 조회도 수정도 하지 않는다 — 새 브랜드만 만든다.
//     · PM 자동 운영은 OFF 로 둔다(검수 후에도 자동 실행되지 않게).
//     · 대량 생성 방지 — 이미 있으면 그 브랜드를 다시 쓴다(멱등).
import { query, queryOne } from "./db";

export const PM_QA_PREFIX = "[PM검수]";

export interface PmQaResult {
  brandId: string;
  brandName: string;
  created: boolean;
  kpis: number;
  tasks: number;
  comms: number;
  note: string;
}

/**
 * 합성 테스트 브랜드 + PM 검수 데이터. exec 만 호출한다(호출자가 확인).
 *   같은 이름의 테스트 브랜드가 이미 있으면 재사용하고 부족한 데이터만 채운다.
 */
export async function ensurePmQaFixture(actor: string): Promise<PmQaResult> {
  const name = `${PM_QA_PREFIX} 샘플브랜드`;

  let brand = await queryOne<{ id: string; is_test: boolean }>(
    "SELECT id, COALESCE(is_test,false) AS is_test FROM brands WHERE brand_name=$1 AND COALESCE(is_test,false)=true",
    [name]);
  let created = false;
  if (!brand) {
    // 연락처를 비워 둔다 — 어떤 발송 경로에도 대상이 될 수 없다.
    //   state='dropped' — 기존 백그라운드 작업이 제외하는 상태로 만들어 집계 오염을 막는다.
    const r = await queryOne<{ id: string }>(
      `INSERT INTO brands (brand_name, state, is_test, email, phone, contact_name, source, next_action)
       VALUES ($1, 'dropped', true, NULL, NULL, NULL, 'manual',
               'PM 운영 검수용 합성 브랜드 — 실제 고객 아님') RETURNING id`, [name]);
    if (!r) throw new Error("테스트 브랜드 생성 실패");
    brand = { id: r.id, is_test: true };
    created = true;
  }
  if (!brand.is_test) throw new Error("테스트 브랜드가 아닙니다 — 중단했습니다.");
  const brandId = brand.id;

  // PM 설정 — 자동 운영은 OFF 로 둔다.
  await query(
    `INSERT INTO pm_brand_config (brand_id, enabled, owner_admin_id, note)
     VALUES ($1, false, $2, 'PM 운영 검수용 합성 브랜드 — 실제 고객 아님. 자동 운영 OFF.')
     ON CONFLICT (brand_id) DO UPDATE SET enabled=false, updated_at=now()`, [brandId, actor]);

  // KPI 3건 — 값 없음 / 0 / 역방향을 각각 확인할 수 있게.
  const kpiSeed: { name: string; unit: string; target: number | null; current: number | null; direction: "up" | "down"; measured: string | null; evidence: string }[] = [
    { name: "월 매출", unit: "만원", target: 5000, current: 0, direction: "up", measured: null, evidence: "검수용 샘플 — 현재값 0(값 없음과 구분 확인)" },
    { name: "목표 미입력 지표", unit: "건", target: null, current: 12, direction: "up", measured: null, evidence: "검수용 샘플 — 목표 없음" },
    { name: "반품률", unit: "%", target: 3, current: 7, direction: "down", measured: null, evidence: "검수용 샘플 — 낮을수록 좋은 역방향 지표" },
  ];
  let kpis = 0;
  for (const k of kpiSeed) {
    const dup = await queryOne<{ id: string }>(
      "SELECT id FROM pm_kpis WHERE brand_id=$1 AND name=$2 AND status='active'", [brandId, k.name]);
    if (dup) continue;
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    await query(
      `INSERT INTO pm_kpis (brand_id, name, unit, target_value, current_value, measured_at,
          direction, period_start, period_end, owner_admin_id, evidence, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12)`,
      [brandId, k.name, k.unit, k.target, k.current,
       k.current == null ? null : today, k.direction, today, today, actor, k.evidence, actor]);
    kpis++;
  }

  // 수동 대화 2건 — 수집 미연결 채널의 원문 등록 경로 확인용.
  const commSeed = [
    { channel: "kakao", label: "검수용 카톡 대화", body: "검수용 합성 대화입니다. 실제 고객 대화가 아닙니다.", ago: 3 },
    { channel: "call", label: "검수용 통화 메모", body: "검수용 합성 통화 기록입니다. 실제 고객 대화가 아닙니다.", ago: 20 },
  ];
  let comms = 0;
  for (const c of commSeed) {
    const dup = await queryOne<{ id: string }>(
      "SELECT id FROM pm_manual_comms WHERE brand_id=$1 AND source_label=$2", [brandId, c.label]);
    if (dup) continue;
    await query(
      `INSERT INTO pm_manual_comms (brand_id, channel, occurred_at, author, source_label, body, created_by)
       VALUES ($1,$2, now() - ($3 || ' days')::interval, '검수', $4, $5, $6)`,
      [brandId, c.channel, c.ago, c.label, c.body, actor]);
    comms++;
  }

  // 업무 2건 — 사람이 만든 업무(지연 1건, 미배정 1건).
  const taskSeed = [
    { title: "검수용 지연 업무", kind: "todo" as const, prio: 1, dueAgo: 5, owner: actor },
    { title: "검수용 담당 미배정 업무", kind: "issue" as const, prio: 2, dueAgo: null as number | null, owner: null },
  ];
  let tasks = 0;
  for (const t of taskSeed) {
    const dup = await queryOne<{ id: string }>(
      "SELECT id FROM pm_tasks WHERE brand_id=$1 AND title=$2", [brandId, t.title]);
    if (dup) continue;
    await query(
      `INSERT INTO pm_tasks (brand_id, kind, title, detail, priority, owner_admin_id, due_date,
          origin, confirmed_by, confirmed_at, created_by)
       VALUES ($1,$2,$3,'PM 운영 검수용 합성 업무입니다.',$4,$5,
               ${t.dueAgo == null ? "NULL" : `(now() - interval '${t.dueAgo} days')::date`},
               'human',$6,now(),$6)`,
      [brandId, t.kind, t.title, t.prio, t.owner, actor]);
    tasks++;
  }

  return {
    brandId, brandName: name, created, kpis, tasks, comms,
    note: [
      created ? "테스트 브랜드를 새로 만들었습니다(state=dropped — 백그라운드 집계 제외)" : "기존 테스트 브랜드를 재사용했습니다",
      `KPI +${kpis} · 업무 +${tasks} · 수동대화 +${comms}`,
      "is_test=true · state=dropped · 연락처 없음 · PM 자동 운영 OFF",
    ].join(" · "),
  };
}
