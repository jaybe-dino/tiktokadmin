import { CsvImportForm, ManualAddForm } from "@/components/ImportForms";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold mb-1">데이터 가져오기</h1>
      <p className="text-sm text-muted mb-4">
        사이트 연동 전에도 브랜드를 직접 넣을 수 있습니다. <b>현재 단계·등급·플랜·결제상태·담당까지 그대로 반영</b>되며,
        같은 이메일/전화/사업자번호는 자동 병합됩니다. (기존 데이터 마이그레이션용)
      </p>

      <section className="card p-4 mb-4">
        <h2 className="font-bold mb-2">① 브랜드 직접 추가</h2>
        <ManualAddForm />
      </section>

      <section className="card p-4">
        <h2 className="font-bold mb-2">② CSV 가져오기 (대량)</h2>
        <CsvImportForm />
      </section>
    </div>
  );
}
