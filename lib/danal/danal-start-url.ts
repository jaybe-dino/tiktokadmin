// Reused from EscapeMate bdcd31f011c619e1068e82c7fa390ef534b0de04; no live calls during development.
// Allow-list for the Danal BATCH AUTH STARTURL (the page the browser POSTs STARTPARAMS to).
// Pure and dependency-free: shared by the server (verifyAuth) and the client hand-off
// (checkout-form) so the two can never drift. The provider REQUEST URL is separate and
// fixed (DANAL_CREDIT_URL); this only decides where a customer's browser may be sent.
//
// Allowed: https, no userinfo, default port, and EITHER
//   - exactly checkout.teledit.com (observed in a real authenticated AUTH 0000 response,
//     2026-10-12; Danal's legacy card checkout host), or
//   - danalpay.com / *.danalpay.com (the existing policy).
// Never any other *.teledit.com host, lookalike or suffix trick.

export const DANAL_START_EXACT_HOSTS: readonly string[] = ["checkout.teledit.com"];

export function isAllowedDanalStartUrl(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return false;
  const host = url.hostname;
  return DANAL_START_EXACT_HOSTS.includes(host) || host === "danalpay.com" || host.endsWith(".danalpay.com");
}
