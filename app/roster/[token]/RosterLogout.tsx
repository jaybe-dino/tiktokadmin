"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { rosterLogoutAction } from "./actions";

export default function RosterLogout() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(async () => { await rosterLogoutAction(); router.refresh(); })}
      style={{ border: "1px solid #dfe3e8", background: "#fff", color: "#4b5563", borderRadius: 9, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
    >
      {pending ? "로그아웃 중…" : "로그아웃"}
    </button>
  );
}
