export default function ScreenHeader({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h1 className="text-[19px] font-extrabold">{title}</h1>
        {desc && <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function won(n: number | null | undefined): string {
  return (Number(n ?? 0)).toLocaleString("ko-KR") + "원";
}
