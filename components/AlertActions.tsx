"use client";

import { useRouter } from "next/navigation";
import { snoozeAction } from "@/app/actions";

export default function AlertActions({ alertId }: { alertId: string }) {
  const router = useRouter();
  return (
    <button
      className="btn text-xs py-1"
      onClick={async () => {
        await snoozeAction(alertId);
        router.refresh();
      }}
    >
      1일 스누즈
    </button>
  );
}
