import { queryRo } from "./db";
import { importBrandRecord, type ImportRecord } from "./import";
import { FIELD_RE as RE, pick } from "./field-detect";

// glovek Postgres 직접 적재(backfill). 읽기전용 롤(GLOVEK_DB_URL_RO 또는 공유 DATABASE_URL)로
// glovek 기존 테이블을 읽어 brands 원장에 병합한다.
// 실제 컬럼명이 문서와 달라도 동작하도록 "컬럼명 패턴 매칭"(field-detect)으로 필드를 뽑는다.

async function tableExists(name: string): Promise<boolean> {
  try {
    await queryRo(`SELECT 1 FROM ${name} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

interface TableReport {
  table: string;
  status: "ok" | "missing" | "error";
  rows?: number;
  created?: number;
  merged?: number;
  skipped?: number;
  error?: string;
}

const LIMIT = 20000;

function mapPayStatus(s: string | undefined): string | undefined {
  const v = (s ?? "").toLowerCase();
  if (["active", "subscribed", "paid", "ok"].includes(v)) return "subscribed";
  if (["past_due", "pastdue", "overdue", "failed"].includes(v)) return "past_due";
  if (["canceled", "cancelled", "expired"].includes(v)) return "canceled";
  return undefined;
}

export async function backfillGlovek(actorId: string): Promise<{ ok: boolean; tables: TableReport[]; note: string }> {
  const tables: TableReport[] = [];

  // 0) users 이메일 맵 (구독·진단이 user_id 로만 연결될 때 사용)
  const userEmail = new Map<string, string>();
  if (await tableExists("users")) {
    try {
      const us = await queryRo<Record<string, unknown>>(`SELECT * FROM users LIMIT ${LIMIT}`);
      for (const u of us) {
        const id = pick(u, RE.id);
        const em = pick(u, RE.email);
        if (id && em) userEmail.set(id, em);
      }
    } catch { /* ignore */ }
  }

  // 1) 리드 계열
  const leadTables = [
    { name: "consult_requests", source: "glovek_consult", state: "contact" },
    { name: "inquiries", source: "glovek_inquiry", state: "lead_new" },
    { name: "users", source: "glovek_signup", state: "lead_new" },
  ];
  for (const t of leadTables) {
    await runTable(tables, t.name, actorId, (row) => ({
      email: pick(row, RE.email),
      phone: pick(row, RE.phone),
      biz_no: pick(row, RE.biz_no),
      brand_name: pick(row, RE.brand),
      contact_name: pick(row, RE.contact),
      category: pick(row, RE.category),
      brand_url: pick(row, RE.url),
      memo: pick(row, RE.message),
      source: t.source,
      state: t.state,
      glovek_user_id: t.name === "users" ? pick(row, RE.id) : pick(row, RE.userId),
    }));
  }

  // 2) 진단 (등급·추천트랙)
  await runTable(tables, "onboarding_applications", actorId, (row) => {
    const uid = pick(row, RE.userId);
    return {
      email: pick(row, RE.email) ?? (uid ? userEmail.get(uid) : undefined),
      biz_no: pick(row, RE.biz_no),
      brand_name: pick(row, RE.brand),
      grade: pick(row, RE.grade),
      rec_track: normalizeTrack(pick(row, RE.rec_track)),
      source: "glovek_consult",
      glovek_user_id: uid,
      glovek_onb_id: pick(row, RE.id),
    };
  });

  // 3) 결제 (멀티몰 정기 구독)
  await runTable(tables, "mall_subscriptions", actorId, (row) => {
    const uid = pick(row, RE.userId);
    const pay = mapPayStatus(pick(row, RE.status));
    return {
      email: pick(row, RE.email) ?? (uid ? userEmail.get(uid) : undefined),
      brand_name: pick(row, RE.brand),
      plan: "live_focus_490k",
      contract_type: "mall",
      pay_status: pay,
      state: pay === "subscribed" ? "live_mall" : "contract_done",
      source: "glovek_consult",
      glovek_user_id: uid,
    };
  });

  const okCount = tables.filter((t) => t.status === "ok").length;
  const note = okCount === 0
    ? "glovek 테이블을 찾지 못했습니다. GLOVEK_DB_URL_RO(또는 공유 DATABASE_URL)가 glovek DB를 가리키는지 확인하세요."
    : `${okCount}개 테이블에서 적재 완료.`;
  return { ok: true, tables, note };
}

function normalizeTrack(v: string | undefined): string | undefined {
  const t = (v ?? "").toLowerCase();
  if (t.includes("onboard")) return "onboarding";
  if (t.includes("live")) return "live";
  return undefined;
}

async function runTable(
  out: TableReport[],
  name: string,
  actorId: string,
  toRec: (row: Record<string, unknown>) => ImportRecord,
): Promise<void> {
  if (!(await tableExists(name))) {
    out.push({ table: name, status: "missing" });
    return;
  }
  try {
    const rows = await queryRo<Record<string, unknown>>(`SELECT * FROM ${name} LIMIT ${LIMIT}`);
    let created = 0, merged = 0, skipped = 0;
    for (const row of rows) {
      const rec = toRec(row);
      // dedup 키가 없으면 건너뜀
      if (!rec.email && !rec.phone && !rec.biz_no) { skipped++; continue; }
      const res = await importBrandRecord(actorId, rec);
      if (!res.ok) skipped++;
      else if (res.created) created++;
      else merged++;
    }
    out.push({ table: name, status: "ok", rows: rows.length, created, merged, skipped });
  } catch (err) {
    out.push({ table: name, status: "error", error: (err as Error).message });
  }
}
