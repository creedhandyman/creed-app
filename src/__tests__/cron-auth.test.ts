import type { NextRequest } from "next/server";
import { cronAuth } from "@/lib/cron-auth";

const req = (h: Record<string, string>) =>
  ({ headers: new Headers(h) }) as unknown as NextRequest;

describe("cronAuth", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-s3cret";
    process.env.ADMIN_PASSWORD = "admin-pw";
  });
  afterAll(() => { process.env = env; });

  it("accepts the cron secret bearer and the admin token", () => {
    expect(cronAuth(req({ authorization: "Bearer cron-s3cret" }))).toBe("cron_secret");
    expect(cronAuth(req({ "x-admin-token": "admin-pw" }))).toBe("admin_token");
  });

  it("never accepts the bare x-vercel-cron header", () => {
    expect(cronAuth(req({ "x-vercel-cron": "1" }))).toBeNull();
  });

  it("rejects wrong or missing credentials", () => {
    expect(cronAuth(req({}))).toBeNull();
    expect(cronAuth(req({ authorization: "Bearer nope" }))).toBeNull();
    expect(cronAuth(req({ "x-admin-token": "admin-pw-x" }))).toBeNull();
  });

  it("an unset secret matches nothing", () => {
    delete process.env.CRON_SECRET;
    delete process.env.ADMIN_PASSWORD;
    expect(cronAuth(req({ authorization: "Bearer " }))).toBeNull();
    expect(cronAuth(req({ authorization: "Bearer undefined" }))).toBeNull();
    expect(cronAuth(req({ "x-admin-token": "" }))).toBeNull();
  });
});
