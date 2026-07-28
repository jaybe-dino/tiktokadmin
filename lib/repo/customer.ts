import { query } from "../db";
import type { FileKind } from "../types";

// 고객 자료(파일) · 제안서 · 인증국가 (M6).

export interface BrandFile {
  id: string;
  brand_id: string;
  kind: FileKind;
  label: string;
  url: string;
  note: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Proposal {
  id: string;
  brand_id: string;
  title: string;
  url: string;
  amount: number | null;
  status: string;
  note: string;
  created_by: string | null;
  created_at: string;
}

export async function listFiles(brandId: string): Promise<BrandFile[]> {
  return query<BrandFile>("SELECT * FROM brand_files WHERE brand_id=$1 ORDER BY kind, created_at DESC", [brandId]);
}

export async function addFile(input: {
  brand_id: string; kind: FileKind; label: string; url: string; note?: string; by: string;
}): Promise<void> {
  await query(
    "INSERT INTO brand_files (brand_id, kind, label, url, note, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [input.brand_id, input.kind, input.label, input.url, input.note ?? "", input.by],
  );
}

export async function deleteFile(id: string): Promise<void> {
  await query("DELETE FROM brand_files WHERE id=$1", [id]);
}

export async function listProposals(brandId: string): Promise<Proposal[]> {
  return query<Proposal>("SELECT * FROM proposals WHERE brand_id=$1 ORDER BY created_at DESC", [brandId]);
}

export async function addProposal(input: {
  brand_id: string; title: string; url?: string; amount?: number; note?: string; by: string;
}): Promise<void> {
  await query(
    "INSERT INTO proposals (brand_id, title, url, amount, note, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [input.brand_id, input.title, input.url ?? "", input.amount ?? null, input.note ?? "", input.by],
  );
}

export async function setProposalStatus(id: string, status: string): Promise<void> {
  await query("UPDATE proposals SET status=$2 WHERE id=$1", [id, status]);
}

export async function deleteProposal(id: string): Promise<void> {
  await query("DELETE FROM proposals WHERE id=$1", [id]);
}

export async function setCertifiedCountries(brandId: string, countries: string[]): Promise<void> {
  await query("UPDATE brands SET certified_countries=$2 WHERE id=$1", [brandId, countries]);
}

export async function setCountries(brandId: string, countries: string[]): Promise<void> {
  await query("UPDATE brands SET countries=$2 WHERE id=$1", [brandId, countries]);
}
