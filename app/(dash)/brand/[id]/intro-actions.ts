"use server";
// 해외 소개자료 서버액션 — 브랜드 권한 가드(PM 과 동일)를 모두 지난다.
//   외부 발송은 하지 않는다. 공개 링크는 담당자가 '발행' 을 눌러야 열린다.
import { revalidatePath } from "next/cache";
import { brandAccess } from "@/lib/pm-access";
import { currentUser } from "@/lib/auth";
import { isIntroLang, INTRO_LANG_LIST, type IntroLang } from "@/lib/intro-langs";
import {
  listIntroDocs, generateIntroDoc, setIntroStatus, setIntroContact,
  getIntroSchemaState, defaultIntroContact, type IntroDocRow, type GenerateResult,
} from "@/lib/brand-intro";

export interface IntroListResult {
  ok: boolean; error?: string;
  data?: {
    schemaReady: boolean; schemaError?: string;
    docs: IntroDocRow[];
    langs: IntroLang[];
    defaultContact: string;
  };
}

export async function introListAction(brandId: string): Promise<IntroListResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  const schema = await getIntroSchemaState();
  if (!schema.ready) {
    return { ok: true, data: { schemaReady: false, schemaError: schema.error, docs: [], langs: INTRO_LANG_LIST, defaultContact: defaultIntroContact() } };
  }
  try {
    const docs = await listIntroDocs(a.access.brandId);
    return { ok: true, data: { schemaReady: true, docs, langs: INTRO_LANG_LIST, defaultContact: defaultIntroContact() } };
  } catch (e) {
    return { ok: false, error: `소개자료 목록을 불러오지 못했습니다 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function introGenerateAction(brandId: string, lang: string): Promise<GenerateResult> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  if (!isIntroLang(lang)) return { ok: false, error: "지원하지 않는 언어입니다." };
  const u = await currentUser();
  if (!u) return { ok: false, error: "권한이 없습니다." };
  try {
    const r = await generateIntroDoc({ brandId: a.access.brandId, lang, by: u.id });
    if (r.ok) revalidatePath(`/brand/${brandId}`);
    return r;
  } catch (e) {
    return { ok: false, error: `생성 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function introPublishAction(brandId: string, lang: string, publish: boolean):
  Promise<{ ok: boolean; error?: string }> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  if (!isIntroLang(lang)) return { ok: false, error: "지원하지 않는 언어입니다." };
  try {
    const r = await setIntroStatus(a.access.brandId, lang, publish ? "published" : "draft");
    if (r.ok) revalidatePath(`/brand/${brandId}`);
    return r;
  } catch (e) {
    return { ok: false, error: `상태 변경 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}

export async function introContactAction(brandId: string, lang: string, email: string):
  Promise<{ ok: boolean; error?: string }> {
  const a = await brandAccess(brandId);
  if (!a.ok) return { ok: false, error: a.error };
  if (!isIntroLang(lang)) return { ok: false, error: "지원하지 않는 언어입니다." };
  try {
    const r = await setIntroContact(a.access.brandId, lang, email);
    if (r.ok) revalidatePath(`/brand/${brandId}`);
    return r;
  } catch (e) {
    return { ok: false, error: `저장 실패 — ${(e as Error).message.slice(0, 200)}` };
  }
}
