import { describe, it, expect } from "vitest";
import { normalizeImageUrl, proposalAssetUrl } from "../lib/asset-url";

describe("asset-url (제안서 이미지 URL 정리)", () => {
  it("드라이브 공유링크 → thumbnail 직접표시 URL", () => {
    expect(normalizeImageUrl("https://drive.google.com/file/d/1AbC_dEf-123456789/view?usp=sharing"))
      .toBe("https://drive.google.com/thumbnail?id=1AbC_dEf-123456789&sz=w1600");
    expect(normalizeImageUrl("https://drive.google.com/open?id=1AbC_dEf-123456789"))
      .toBe("https://drive.google.com/thumbnail?id=1AbC_dEf-123456789&sz=w1600");
    // 일반 URL·빈 값은 그대로
    expect(normalizeImageUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(normalizeImageUrl("")).toBe("");
    expect(normalizeImageUrl(null)).toBe("");
  });

  it("세션 보호 파일 경로 → 토큰 프록시 경로", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    expect(proposalAssetUrl(`/api/brand/import-file/${id}`, "tok1")).toBe(`/api/proposal-asset/tok1/${id}`);
    expect(proposalAssetUrl(`/api/apply/file/${id}`, "tok1")).toBe(`/api/proposal-asset/tok1/${id}`);
    // 외부 URL 은 재작성하지 않음(드라이브는 normalize 만)
    expect(proposalAssetUrl("https://cdn.example.com/a.png", "tok1")).toBe("https://cdn.example.com/a.png");
  });
});
