// 더미 데이터 시드 — 모든 화면이 비어보이지 않게 is_test=true 로 적재.
//   안전: is_test=true 격리(운영 데이터와 섞이지 않음). 재실행 시 중복 방지(가드).
import { getPool } from "./db";
import type { PoolClient } from "pg";

const STAFF = [
  { id: "demo_kim", name: "김지호", role: "sales" },
  { id: "demo_park", name: "박서연", role: "onboard" },
  { id: "demo_lee", name: "이한별", role: "ads" },
  { id: "demo_choi", name: "최유진", role: "intake" },
];

interface DemoBrand {
  name: string; state: string; grade: string | null; plan: string | null;
  category: string; countries: string[]; pay: string; contract: string | null;
  intake?: string; sales?: string; onboard?: string; ads?: string;
}
const BRANDS: DemoBrand[] = [
  { name: "루미에르코스", state: "meeting", grade: "S", plan: "onboarding_onetime", category: "뷰티", countries: ["미국"], pay: "none", contract: null, intake: "demo_choi", sales: "demo_kim" },
  { name: "그린바이트", state: "contact", grade: "A", plan: "live_focus_490k", category: "식품", countries: ["미국", "베트남"], pay: "none", contract: null, sales: "demo_kim" },
  { name: "솔티드코코", state: "contract_review", grade: "A", plan: "onboarding_onetime", category: "뷰티", countries: ["미국", "베트남", "태국"], pay: "none", contract: null, sales: "demo_kim" },
  { name: "네이처글로우", state: "contract_done", grade: "B", plan: "live_focus_490k", category: "뷰티", countries: ["미국"], pay: "subscribed", contract: "mall", sales: "demo_kim", onboard: "demo_park" },
  { name: "하루담", state: "docs", grade: "B", plan: "onboarding_onetime", category: "식품", countries: ["미국", "태국"], pay: "once_paid", contract: "onboarding", onboard: "demo_park" },
  { name: "비바글로우", state: "setup", grade: "A", plan: "live_focus_490k", category: "뷰티", countries: ["미국", "싱가포르"], pay: "subscribed", contract: "mall", onboard: "demo_park", ads: "demo_lee" },
  { name: "코코넛레인", state: "live_mall", grade: "S", plan: "guarantee_1m", category: "뷰티", countries: ["미국", "베트남", "태국", "싱가포르"], pay: "subscribed", contract: "guarantee", ads: "demo_lee" },
  { name: "포레스트홈", state: "live_onboarding", grade: "A", plan: "onboarding_onetime", category: "리빙", countries: ["미국"], pay: "once_paid", contract: "onboarding", ads: "demo_lee" },
  { name: "미소가", state: "settling", grade: "B", plan: "live_focus_490k", category: "식품", countries: ["미국", "베트남"], pay: "subscribed", contract: "mall", ads: "demo_lee" },
  { name: "블룸데이", state: "lead_new", grade: null, plan: null, category: "뷰티", countries: [], pay: "none", contract: null, intake: "demo_choi" },
  { name: "청담키친", state: "seminar", grade: null, plan: null, category: "식품", countries: [], pay: "none", contract: null, intake: "demo_choi" },
  { name: "웨이브샵", state: "dropped", grade: "C", plan: null, category: "패션", countries: [], pay: "none", contract: null },
];

const CERT_TYPES = ["FDA등록", "보건부신고", "태국FDA", "HSA"];
const CERT_STATUS = ["ready", "submitted", "preparing", "none", "expired"];

export async function seedDemo(force = false): Promise<{ seeded: boolean; brands: number; note: string }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query<{ n: string }>("SELECT count(*)::text n FROM brands WHERE is_test=true");
    if (Number(existing[0].n) > 0 && !force) {
      return { seeded: false, brands: Number(existing[0].n), note: "이미 더미데이터 존재(force=1 로 재적재)" };
    }

    await client.query("BEGIN");

    // force 재적재: 기존 데모(is_test) 브랜드 제거 → CASCADE 로 연결 데이터 정리(운영 데이터 무영향).
    if (force) {
      await client.query("DELETE FROM brands WHERE is_test=true");
      // 전역 데모(브랜드 무관) 정리 — SAVEPOINT 로 감싸 실패해도 트랜잭션 유지.
      await soft(client, "DELETE FROM qna_entries WHERE question LIKE '%FDA%' OR question LIKE '%정산은%' OR question LIKE '%시딩 크리에이터%' OR question LIKE '%멀티몰 플랜%'");
      await soft(client, "DELETE FROM bulk_sends WHERE title IN ('여름 세미나 리드 재접촉','운영중 국가추가 제안')");
      await soft(client, "DELETE FROM approval_requests WHERE requested_by IN ('demo_kim','demo_park','demo_lee','demo_choi') AND brand_id IS NULL");
      await soft(client, "DELETE FROM meetings WHERE zoom_uuid LIKE 'demo-%'");
    }

    // 스태프
    for (const s of STAFF) {
      await client.query(
        "INSERT INTO admin_users (id, name, role, active) VALUES ($1,$2,$3,true) ON CONFLICT (id) DO NOTHING",
        [s.id, s.name, s.role]);
    }

    const monthFirst = isoMonthFirst();
    let count = 0;
    for (const b of BRANDS) {
      const bid = await insertBrand(client, b);
      count++;
      await seedBrandChildren(client, bid, b, monthFirst);
    }

    // 전역 지식/발송/결재 (브랜드 무관 or 첫 브랜드 연결)
    await seedGlobal(client);

    await client.query("COMMIT");
    return { seeded: true, brands: count, note: "더미데이터 적재 완료(is_test=true)" };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function insertBrand(c: PoolClient, b: DemoBrand): Promise<string> {
  const email = `${romanize(b.name)}@example.com`;
  // brands.contract_type 은 mall|onboarding 만 허용 → guarantee 는 mall 로 표기(계약 kind 는 별도).
  const contractType = b.contract === "guarantee" ? "mall" : b.contract;
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO brands (brand_name, email, phone, contact_name, category, brand_url, state,
       contract_type, source, plan, pay_status, countries, grade, churn_risk, next_action,
       owner_intake, owner_sales, owner_onboard, owner_ads, is_test, lead_group)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'etc',$9,$10,$11,$12,'low',$13,$14,$15,$16,$17,true,'2026-07 · 데모')
     RETURNING id`,
    [b.name, email, `010${randDigits(8)}`, `${b.name} 담당자`, b.category,
     `https://${romanize(b.name)}.co.kr`, b.state, contractType, b.plan, b.pay,
     b.countries, b.grade, nextActionFor(b.state),
     b.intake ?? null, b.sales ?? null, b.onboard ?? null, b.ads ?? null]);
  return rows[0].id;
}

async function seedBrandChildren(c: PoolClient, bid: string, b: DemoBrand, month: string) {
  // 연락처
  await c.query(
    `INSERT INTO brand_contacts (brand_id, name, title, email, phone, role, is_primary)
     VALUES ($1,$2,'대표',$3,$4,'main',true)`,
    [bid, `${b.name} 대표`, `ceo@${romanize(b.name)}.co.kr`, `010${randDigits(8)}`]);
  if (b.countries.length > 1) {
    await c.query(
      `INSERT INTO brand_contacts (brand_id, name, title, email, role, is_primary)
       VALUES ($1,$2,'마케팅팀장',$3,'marketing',false)`,
      [bid, `${b.name} 마케터`, `mkt@${romanize(b.name)}.co.kr`]);
  }

  // 제품 + 인증 (계약 이후 브랜드만)
  if (["contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling"].includes(b.state)) {
    for (let i = 1; i <= 2; i++) {
      const { rows: pr } = await c.query<{ id: string }>(
        `INSERT INTO products_master (brand_id, name_kr, category, status, source) VALUES ($1,$2,$3,'active','manual') RETURNING id`,
        [bid, `${b.name} 제품${i}`, b.category]);
      const pid = pr[0].id;
      for (const country of b.countries) {
        const st = CERT_STATUS[Math.floor((country.length + i) % CERT_STATUS.length)];
        const expires = st === "ready" || st === "expired"
          ? (st === "expired" ? daysFromNow(-10) : daysFromNow(20 + i * 30)) : null;
        await c.query(
          `INSERT INTO product_certs (product_id, country, cert_type, status, expires_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (product_id,country,cert_type) DO NOTHING`,
          [pid, countryCode(country), CERT_TYPES[i % CERT_TYPES.length], st, expires]);
      }
    }
  }

  // 제안서 (영업 단계 이상)
  if (["contact", "contract_review", "contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling"].includes(b.state) && b.plan) {
    const amt = b.plan === "onboarding_onetime" ? 50_000_000 : 490_000 * Math.max(1, b.countries.length);
    const status = ["contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling"].includes(b.state) ? "accepted" : "sent";
    await c.query(
      `INSERT INTO proposals (brand_id, version, title, plan, countries, term, quote_amount, amount, status, sent_at, created_by)
       VALUES ($1,1,$2,$3,$4,'monthly',$5,$5,$6, now() - interval '10 days', 'demo_kim')`,
      [bid, `${b.name} 제안 v1`, b.plan, b.countries, amt, status]);
  }

  // 계약
  if (b.contract) {
    const status = ["docs", "setup", "live_mall", "live_onboarding", "settling"].includes(b.state) ? "signed" : "review";
    const feePct = b.contract === "guarantee" ? 15 : 10;
    await c.query(
      `INSERT INTO contracts (brand_id, kind, status, start_date, end_date, terms, signed_at)
       VALUES ($1,$2,$3, current_date - 30, current_date + 180, $4, $5)`,
      [bid, b.contract, status, JSON.stringify({ fee_pct: feePct, term_months: 6, countries: b.countries }),
       status === "signed" ? new Date(Date.now() - 20 * 864e5).toISOString() : null]);
  }

  // 미팅 (미팅 단계 이상)
  if (!["lead_new", "seminar"].includes(b.state)) {
    await c.query(
      `INSERT INTO meetings (brand_id, zoom_meeting_id, zoom_uuid, topic, host_email, scheduled_at, started_at,
         status, followup_status, summary_md)
       VALUES ($1,$2,$3,$4,'kim@dinostudio.kr', now() - interval '9 days', now() - interval '9 days',
         'ready','sent',$5)`,
      [bid, randDigits(10), `demo-${bid.slice(0, 8)}-${randDigits(6)}`, `[${b.name}] 1:1 상담`,
       `## 상담 요약 · ${b.name}\n**핵심 니즈**: ${b.category} 해외 진출\n**논의 플랜/국가**: ${b.plan ?? "미정"} · ${b.countries.join(",")}\n**다음 액션**: 제안서 발송`]);
  }

  // 설문 (미팅 이후)
  if (!["lead_new", "seminar", "dropped"].includes(b.state)) {
    const responded = ["contract_review", "contract_done", "docs", "setup", "live_mall", "live_onboarding", "settling"].includes(b.state);
    await c.query(
      `INSERT INTO surveys (brand_id, kind, token, sent_at, responded_at, answers)
       VALUES ($1,'post_meeting',$2, now() - interval '8 days', $3, $4)`,
      [bid, `sv_demo_${randDigits(12)}`, responded ? new Date(Date.now() - 7 * 864e5).toISOString() : null,
       responded ? JSON.stringify({ budget_band: "500~1000만원", target_countries: b.countries, marketing_consent: true }) : "{}"]);
  }

  // 운영 사이클 + 워크아이템 + 정산 (운영중)
  if (["live_mall", "live_onboarding", "settling"].includes(b.state)) {
    const total = 3;
    const done = b.state === "settling" ? 3 : 1 + (b.name.length % 2);
    const { rows: cy } = await c.query<{ id: string }>(
      `INSERT INTO ops_cycles (brand_id, month, plan, status, items_total) VALUES ($1,$2,$3,'active',$4) RETURNING id`,
      [bid, month, b.plan ?? "unknown", total]);
    const cid = cy[0].id;
    const specs = [["seeding", 20], ["live", 4], ["report", 1]] as const;
    for (let i = 0; i < specs.length; i++) {
      await c.query(`INSERT INTO work_items (cycle_id, kind, qty_target, qty_done, status) VALUES ($1,$2,$3,$4,$5)`,
        [cid, specs[i][0], specs[i][1], i < done ? specs[i][1] : Math.floor(specs[i][1] / 3), i < done ? "done" : "in_progress"]);
    }
    // 시딩 몇 건
    for (let i = 0; i < 3; i++) {
      await c.query(
        `INSERT INTO seedings (cycle_id, brand_id, creator_handle, country, status, views)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [cid, bid, `@creator_${romanize(b.name)}_${i}`, countryCode(b.countries[0] ?? "미국"),
         ["posted", "sent", "agreed"][i], i === 0 ? 125000 : null]);
    }
    // 라이브
    await c.query(
      `INSERT INTO lives (cycle_id, brand_id, scheduled_at, country, host, status, gmv, viewers)
       VALUES ($1,$2, now() + interval '3 days', $3, '호스트A', 'planned', $4, $5)`,
      [cid, bid, countryCode(b.countries[0] ?? "미국"), b.state === "settling" ? 8500000 : null, b.state === "settling" ? 3200 : null]);
    // 정산
    const gmv = b.state === "settling" ? 12_000_000 : 8_000_000;
    const fee = Math.floor(gmv * 0.1);
    await c.query(
      `INSERT INTO settlements (brand_id, month, gmv, gmv_source, fee_pct, fee_amount, sub_amount, total, status, anomaly)
       VALUES ($1,$2,$3,'manual',10,$4,490000,$5,$6,$7) ON CONFLICT (brand_id,month) DO NOTHING`,
      [bid, month, gmv, fee, fee + 490000, b.state === "settling" ? "confirmed" : "draft", b.name.length % 3 === 0]);
  }

  // CS 티켓 (운영중 일부)
  if (["live_mall", "settling"].includes(b.state)) {
    await c.query(
      `INSERT INTO cs_tickets (brand_id, channel, subject, body, priority, status, sla_due)
       VALUES ($1,'portal',$2,'제품 상세페이지 번역 관련 문의입니다.',$3,'open', now() + interval '20 hours')`,
      [bid, `${b.name} 리스팅 문의`, b.name.length % 2 ? "high" : "normal"]);
  }

  // 마케팅 프로젝트 (운영중 일부)
  if (["live_mall", "live_onboarding"].includes(b.state)) {
    await c.query(
      `INSERT INTO mkt_projects (brand_id, kind, title, proposal_status, note)
       VALUES ($1,'project',$2,$3,'US 시즌 캠페인')`,
      [bid, `${b.name} US 라이브커머스 시즌2`, ["sent", "negotiating", "won"][b.name.length % 3]]);
  }

  // 자산 (제안서/계약 링크)
  await c.query(
    `INSERT INTO assets (brand_id, kind, filename, external_url, source)
     VALUES ($1,'brand_intro',$2,'https://drive.google.com/demo','drive')`,
    [bid, `${b.name}_브랜드소개서.pdf`]);

  // ── 심화 더미(플로우·전 화면 데이터) — 전부 SAVEPOINT 로 안전 삽입 ──
  const site = b.contract === "onboarding" ? "apply" : "glovek";
  // 유입 소스(칩) + 상태 이력(타임라인)
  await soft(c,
    `INSERT INTO brand_sources (brand_id, site, event, source_ref, payload, occurred_at)
     VALUES ($1,$2,'lead',$3,'{}', now() - interval '20 days') ON CONFLICT (site,event,source_ref) DO NOTHING`,
    [bid, site, `demo-${bid.slice(0, 8)}`]);
  await soft(c,
    `INSERT INTO stage_history (brand_id, from_state, to_state, actor, gate_passed, reason, at)
     VALUES ($1,'lead_new',$2,'demo:seed',true,'데모 전이', now() - interval '14 days')`,
    [bid, b.state]);

  // SLA 위반 알림(모니터·보드 ⚠) — 일부 단계
  if (["contact", "docs"].includes(b.state)) {
    await soft(c, `INSERT INTO alerts (brand_id, kind, tier, message) VALUES ($1,'sla_breach',2,$2)`,
      [bid, `${b.name} · ${b.state} 단계 SLA 초과(데모)`]);
  }
  // 공개신호 est_gmv(인사이트·브리프) — 운영중
  if (["live_mall", "live_onboarding", "settling"].includes(b.state)) {
    await soft(c,
      `INSERT INTO brand_signals (brand_id, source, metric, value_num, confidence) VALUES ($1,'glovek_crawler','est_gmv',$2,'high')`,
      [bid, 8_000_000 + b.name.length * 100000]);
  }
  // 수기 결제(결제 화면) — created_by NOT NULL 필수
  if (b.pay === "once_paid" || b.pay === "subscribed") {
    await soft(c,
      `INSERT INTO payments_manual (brand_id, plan, amount, method, paid_at, created_by)
       VALUES ($1,$2,$3,'카드', (now() - interval '10 days')::date, 'demo:seed')`,
      [bid, b.plan ?? "live_focus_490k", b.pay === "once_paid" ? 5_000_000 : 490_000]);
  }
  // 서류 체크리스트(온보딩·docs→setup 게이트)
  if (["docs", "setup", "live_mall", "live_onboarding", "settling"].includes(b.state)) {
    const tmpl = b.contract === "onboarding" ? "onboarding" : "mall";
    const doneAll = ["setup", "live_mall", "live_onboarding", "settling"].includes(b.state);
    for (const [k, l] of [["biz_reg", "사업자등록증"], ["gmail", "구글 계정"], ["logistics", "물류 계약"]] as const) {
      await soft(c,
        `INSERT INTO doc_items (brand_id, template, item_key, label, done) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (brand_id, item_key) DO NOTHING`,
        [bid, tmpl, k, l, doneAll]);
    }
  }
  // 회사정보(회사정보 탭) — 계약 이후
  if (b.contract) {
    await soft(c,
      `INSERT INTO brand_company (brand_id, company_name_kr, rep_name, biz_category, tax_email, tax_cycle, bank_name, bank_holder, bank_verified)
       VALUES ($1,$2,$3,'도소매/화장품',$4,'monthly','국민은행',$5,true) ON CONFLICT (brand_id) DO NOTHING`,
      [bid, `${b.name} 주식회사`, `${b.name} 대표`, `tax@${romanize(b.name)}.co.kr`, `${b.name} 주식회사`]);
  }
  // 재고 입고(재고 탭) — 운영중
  if (["live_mall", "settling"].includes(b.state)) {
    await soft(c,
      `INSERT INTO inventory_intakes (brand_id, country, qty, status, tracking_no, arrived_at)
       VALUES ($1,$2,500,'stocked',$3, current_date - 5)`,
      [bid, countryCode(b.countries[0] ?? "미국"), "TRK" + randDigits(8)]);
  }

  // 이메일 스레드 (수집 메일 — 미팅 이후)
  if (!["lead_new", "seminar", "dropped"].includes(b.state)) {
    const thread = `thread_demo_${randDigits(10)}`;
    const owner = "kim@dinostudio.kr";
    const brandEmail = `${romanize(b.name)}@example.com`;
    await c.query(
      `INSERT INTO email_messages (brand_id, gmail_msg_id, thread_id, direction, owner_email, from_addr, to_addrs, subject, snippet, sent_at)
       VALUES ($1,$2,$3,'out',$4,$4,$5,$6,$7, now() - interval '5 days')`,
      [bid, `msg_${randDigits(14)}`, thread, owner, [brandEmail],
       `[GloveK] ${b.name} 진행 안내`, "안녕하세요, 논의된 제안 관련 자료 보내드립니다..."]);
    // 절반은 브랜드 회신(in) 있음 — 미답 상태(자동 회신 초안 대상)
    if (b.name.length % 2 === 0) {
      const inBody = `안녕하세요, ${b.name} 담당자입니다.\n보내주신 제안 잘 확인했습니다. 몇 가지 문의드립니다.\n1) ${b.countries.join("·")} 진출 시 필요한 인증 서류와 예상 소요기간이 궁금합니다.\n2) 정산 주기와 수수료 조건을 다시 안내해 주실 수 있을까요?\n3) 다음 주 중 미팅 일정 조율 가능합니다.\n감사합니다.`;
      await c.query(
        `INSERT INTO email_messages (brand_id, gmail_msg_id, thread_id, direction, owner_email, from_addr, to_addrs, subject, snippet, body_text, sent_at)
         VALUES ($1,$2,$3,'in',$4,$5,$6,$7,$8,$9, now() - interval '3 days')`,
        [bid, `msg_${randDigits(14)}`, thread, owner, brandEmail, [owner],
         `RE: [GloveK] ${b.name} 진행 안내`,
         "보내주신 제안 확인했습니다. 인증 서류·정산 조건 문의드리며, 다음 주 미팅 가능합니다.", inBody]);
    }
  }

  // 팔로업 초안 (미팅 이후 일부)
  if (["meeting", "contact"].includes(b.state)) {
    await c.query(
      `INSERT INTO email_drafts (brand_id, kind, to_email, subject, body_md, status)
       VALUES ($1,'followup',$2,$3,$4,'draft')`,
      [bid, `${romanize(b.name)}@example.com`, `[GloveK] ${b.name} 상담 감사드립니다`,
       `${b.name} 담당자님, 오늘 미팅 감사드립니다. 논의하신 ${b.countries.join("·")} 진출 관련 제안을 준비 중입니다.`]);
  }
}

async function seedGlobal(c: PoolClient) {
  // QnA 지식베이스
  const qnas = [
    ["미국 FDA 등록은 얼마나 걸리나요?", "시설등록(FCE)은 보통 2~4주, 제품 상세는 성분에 따라 상이합니다.", "인증"],
    ["정산은 언제 이뤄지나요?", "매월 말일 마감 후 익월 15일 세금계산서 발행·지급됩니다.", "정산"],
    ["시딩 크리에이터는 어떻게 선정되나요?", "카테고리·국가·평균 조회수 기반으로 시스템이 추천하고 담당이 확정합니다.", "운영"],
    ["멀티몰 플랜과 온보딩 차이는?", "멀티몰은 월 정기 운영, 온보딩은 입점 셋업 중심의 일회 프로젝트입니다.", "플랜"],
  ];
  for (const [q, a, cat] of qnas) {
    await c.query(
      `INSERT INTO qna_entries (question, answer, category, approved, usage_count) VALUES ($1,$2,$3,true,$4)`,
      [q, a, cat, Math.floor(Math.random() > 0 ? (q.length % 12) : 0)]);
  }

  // 발송 센터
  await c.query(
    `INSERT INTO bulk_sends (title, target_kind, target_def, channel, body_md, status, total, sent, created_by)
     VALUES ('여름 세미나 리드 재접촉','lead_group','{"group":"2026-07 · 데모"}','email',
       '{브랜드명}님, 지난 세미나 이후 준비되신 사항이 있으신가요?','done',12,11,'demo_kim')`);
  await c.query(
    `INSERT INTO bulk_sends (title, target_kind, target_def, channel, body_md, status, total, created_by)
     VALUES ('운영중 국가추가 제안','filter','{"state":["live_mall"]}','both',
       '{브랜드명} GMV 상위 국가 확장 제안드립니다.','draft',5,'demo_kim')`);

  // 결재함 (승인 대기)
  const { rows: br } = await c.query<{ id: string }>("SELECT id FROM brands WHERE is_test=true AND state='dropped' LIMIT 1");
  if (br[0]) {
    await c.query(
      `INSERT INTO approval_requests (brand_id, kind, payload, requested_by, status)
       VALUES ($1,'drop','{"reason":"자체운영 전환"}','demo_choi','pending')`,
      [br[0].id]);
  }
  await c.query(
    `INSERT INTO approval_requests (kind, payload, requested_by, status)
     VALUES ('refund','{"amount":-1500000,"note":"온보딩 부분 환불"}','demo_park','pending')`);
  await c.query(
    `INSERT INTO approval_requests (kind, payload, requested_by, status)
     VALUES ('settlement','{"month":"2026-07","note":"이상치 검토"}','demo_lee','pending')`);
}

// ── 유틸 ───────────────────────────────────────────────────────
/**
 * SAVEPOINT 로 감싼 안전 삽입 — 트랜잭션 안에서 개별 statement 실패가
 * 전체 트랜잭션을 오염("current transaction is aborted")시키지 않게 격리.
 */
let __sp = 0;
async function soft(c: PoolClient, sql: string, params: unknown[] = []): Promise<void> {
  const sp = `sp_${__sp++}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await c.query(sql, params);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`).catch(() => {});
    console.warn("[demo-seed] soft skip:", (e as Error).message.slice(0, 120));
  }
}

function isoMonthFirst(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
}
function randDigits(n: number): string {
  let s = ""; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function countryCode(k: string): string {
  return ({ 미국: "US", 베트남: "VN", 태국: "TH", 싱가포르: "SG", 필리핀: "PH", 말레이시아: "MY" } as Record<string, string>)[k] ?? k;
}
function nextActionFor(state: string): string {
  return ({
    lead_new: "2일 내 1차 컨택", seminar: "1:1 미팅 전환/드랍 결정", meeting: "제안서 작성",
    contact: "제안서 발송·팔로업", contract_review: "계약 조건 협의", contract_done: "서류 착수",
    docs: "서류 100% 수급", setup: "입점 셋업 점검", live_mall: "이번 달 시딩 진행",
    live_onboarding: "온보딩 마일스톤", settling: "정산 확정",
  } as Record<string, string>)[state] ?? "";
}
const ROMAN: Record<string, string> = {
  루미에르코스: "lumiere", 그린바이트: "greenbite", 솔티드코코: "saltedcoco", 네이처글로우: "natureglow",
  하루담: "harudam", 비바글로우: "vivaglow", 코코넛레인: "coconutlane", 포레스트홈: "foresthome",
  미소가: "misoga", 블룸데이: "bloomday", 청담키친: "chungdamkitchen", 웨이브샵: "waveshop",
};
function romanize(name: string): string {
  return ROMAN[name] ?? "brand";
}
