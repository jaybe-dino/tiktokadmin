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

/** Vercel/Neon 연동이 만드는 여러 env 이름 중 존재하는 첫 값. */
function resolveDbUrl(): string {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.DATABASE_URL_UNPOOLED,
    process.env.POSTGRES_URL_NON_POOLING,
  ];
  const found = candidates.find(Boolean);
  if (!found) throw new Error("DATABASE_URL(또는 POSTGRES_URL) 이 설정되지 않았습니다.");
  return found;
}

export const env = {
  get databaseUrl() {
    return resolveDbUrl();
  },
  /** glovek 읽기전용 롤 (없으면 기본 DB URL 사용) */
  get glovekReadUrl() {
    return process.env.GLOVEK_DB_URL_RO || resolveDbUrl();
  },
  get ingestSecret() {
    return req("INGEST_SECRET");
  },
  /** 커넥터 리드훅(/api/leadhook) 시크릿 — 미설정 시 INGEST_SECRET 폴백. */
  get leadhookSecret() {
    return opt("LEADHOOK_SECRET") || opt("INGEST_SECRET");
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
  get anthropicModel() {
    return opt("ANTHROPIC_MODEL", "claude-sonnet-5");
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
  zoom: {
    get accountId() { return opt("ZOOM_ACCOUNT_ID"); },
    get clientId() { return opt("ZOOM_CLIENT_ID"); },
    get clientSecret() { return opt("ZOOM_CLIENT_SECRET"); },
    get webhookSecret() { return opt("ZOOM_WEBHOOK_SECRET"); },
  },
  get openaiKey() { return opt("OPENAI_API_KEY") || opt("GROQ_API_KEY"); },
  gmail: {
    get saKeyJson() { return opt("GOOGLE_SA_KEY_JSON"); },
    get pubsubTopic() { return opt("GMAIL_PUBSUB_TOPIC"); },
  },
  meta: {
    // 메타(페이스북) Lead Ads 웹훅 — 리드 폼 제출 시 어드민으로 직접 유입
    get verifyToken() { return opt("META_VERIFY_TOKEN"); },          // 웹훅 구독 검증용(내가 정한 문자열)
    get accessToken() { return opt("META_PAGE_ACCESS_TOKEN"); },      // 페이지 액세스 토큰(leads_retrieval 권한)
    get appSecret() { return opt("META_APP_SECRET"); },               // 서명 검증(선택·권장)
  },
  aligo: {
    get apiKey() { return opt("ALIGO_API_KEY"); },
    get userId() { return opt("ALIGO_USER_ID"); },
    get sender() { return opt("ALIGO_SENDER"); },        // 사전등록 발신번호
    get testMode() { return opt("ALIGO_TEST_MODE").toUpperCase() === "Y"; },
    // 고정 IP 프록시 — Aligo 발송IP 등록용. Fixie Vercel 연동은 FIXIE_URL 로 자동 주입되므로 폴백.
    get proxyUrl() { return opt("ALIGO_PROXY_URL") || opt("FIXIE_URL"); },
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
