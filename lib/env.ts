// 환경변수 파싱/검증. 00-MASTER-PLAN 4-4 규약.
// 서버 전용 — 클라이언트 번들에 포함되지 않도록 route/server component 에서만 import.

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name} 가 설정되지 않았습니다.`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get databaseUrl() {
    return req("DATABASE_URL");
  },
  /** glovek 읽기전용 롤 (없으면 DATABASE_URL 사용) */
  get glovekReadUrl() {
    return process.env.GLOVEK_DB_URL_RO || req("DATABASE_URL");
  },
  get ingestSecret() {
    return req("INGEST_SECRET");
  },
  get sessionSecret() {
    return req("ADMIN_SESSION_SECRET");
  },
  get allowedEmails(): string[] {
    return opt("ADMIN_ALLOWED_EMAILS")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get cronSecret() {
    return opt("CRON_SECRET");
  },
  get adminUrl() {
    return opt("ADMIN_URL", "http://localhost:3000");
  },
  slack: {
    get botToken() {
      return opt("SLACK_BOT_TOKEN");
    },
    get signingSecret() {
      return opt("SLACK_SIGNING_SECRET");
    },
    channels: {
      get intake() {
        return opt("SLACK_CH_INTAKE");
      },
      get onboard() {
        return opt("SLACK_CH_ONBOARD");
      },
      get ads() {
        return opt("SLACK_CH_ADS");
      },
      get pay() {
        return opt("SLACK_CH_PAY");
      },
      get leads() {
        return opt("SLACK_CH_LEADS");
      },
      get daily() {
        return opt("SLACK_CH_DAILY");
      },
    },
  },
  get anthropicKey() {
    return opt("ANTHROPIC_API_KEY");
  },
  resend: {
    get apiKey() {
      return opt("RESEND_API_KEY");
    },
    get from() {
      return opt("RESEND_FROM", "Glovek <onboarding@glovek.space>");
    },
  },
  get mcpToken() {
    return opt("MCP_TOKEN");
  },
};

/** Slack 채널 key → 실제 채널 ID 매핑 (05 라우팅) */
export function slackChannel(key: string): string {
  const map: Record<string, string> = {
    intake: env.slack.channels.intake,
    onboard: env.slack.channels.onboard,
    ads: env.slack.channels.ads,
    pay: env.slack.channels.pay,
    leads: env.slack.channels.leads,
    daily: env.slack.channels.daily,
  };
  return map[key] ?? "";
}
