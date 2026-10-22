import { describe, expect, it } from "vitest";
import type { NextRequest as Req } from "next/server";
import { NextRequest } from "next/server";
import { expectNoOutsideCalls } from "./setup";
import { GET as cron } from "@/app/api/cron/route";
import { POST as moderation } from "@/app/api/admin/moderation/route";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POST as serperImages } from "@/app/api/serper-images/route";

const r = (url: string, headers: Record<string, string> = {}, method = "GET", body?: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });

describe("admin / cron routes refuse unauthenticated callers", () => {
  it("cron: 401 without bearer, 401 with wrong bearer", async () => {
    expect((await cron(r("https://waifu100.vercel.app/api/cron"))).status).toBe(401);
    expect((await cron(r("https://waifu100.vercel.app/api/cron", { authorization: "Bearer wrong" }))).status).toBe(401);
    expectNoOutsideCalls();
  });
  it("admin moderation: 401 without / with wrong x-admin-token", async () => {
    const body = { hash: "a".repeat(64), verdict: "block" };
    expect((await moderation(r("https://waifu100.vercel.app/api/admin/moderation", {}, "POST", body))).status).toBe(401);
    expect((await moderation(r("https://waifu100.vercel.app/api/admin/moderation", { "x-admin-token": "nope" }, "POST", body))).status).toBe(401);
  });
  it("serper-images: 401 without admin token (never reaches Serper)", async () => {
    expect((await serperImages(r("https://waifu100.vercel.app/api/serper-images", {}, "POST", { directQuery: "x" }))).status).toBe(401);
    expectNoOutsideCalls();
  });
});

// The admin desk routes are new (not on main yet); this block runs once they exist.
// Imported by a runtime path so typecheck doesn't depend on them.
const DESK = ["grids", "sessions"].map((n) => fileURLToPath(new URL(`../../src/app/api/admin/${n}/route.ts`, import.meta.url)));
type Route = (r: Req) => Promise<Response>;
describe.skipIf(!DESK.every((p) => existsSync(p)))("admin desk (localhost-only)", () => {
  it("grids/sessions are refused off-localhost (404 by design, not 401)", async () => {
    const [grids, sessions] = (await Promise.all(DESK.map((p) => import(/* @vite-ignore */ p)))) as { GET: Route; DELETE?: Route }[];
    const adminGrids = grids.GET, adminGridsDelete = grids.DELETE!, adminSessions = sessions.GET;
    const host = { host: "waifu100.vercel.app" };
    expect((await adminGrids(r("https://waifu100.vercel.app/api/admin/grids", host))).status).toBe(404);
    expect((await adminGridsDelete(r("https://waifu100.vercel.app/api/admin/grids", host, "DELETE", { id: "x" }))).status).toBe(404);
    expect((await adminSessions(r("https://waifu100.vercel.app/api/admin/sessions", host))).status).toBe(404);
    expectNoOutsideCalls();
  });
});
