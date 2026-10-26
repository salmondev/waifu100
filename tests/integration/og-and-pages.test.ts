import { describe, expect, it, vi } from "vitest";
import { expectNoOutsideCalls, redis } from "./setup";
import { ctx, req, seedShare } from "./helpers";
import { POST as createShare } from "@/app/api/share/route";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3200" }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/server/text-screen", () => ({ screenUserTexts: vi.fn(async () => true), clearTextScreenCache: () => {} }));

import { GET as shareImage } from "@/app/api/share/image/[id]/route";
import { GET as compareImage } from "@/app/api/compare/image/route";
import ViewSharePage, { generateMetadata as viewMeta } from "@/app/view/[id]/page";
import ComparePage, { generateMetadata as compareMeta } from "@/app/compare/page";

async function realShare(names: string[], title: string) {
  const res = await createShare(req("/api/share", { method: "POST", body: { kind: "waifu", size: 100, customTitle: title, grid: names.map((n, i) => ({ i, m: 10 + i, n, img: `https://img.example.com/${i}.jpg`, s: "Fate" })) } }));
  return ((await res.json()) as { id: string }).id;
}
const isRedirect = (e: unknown) => String((e as { digest?: string })?.digest ?? e).includes("NEXT_REDIRECT");

describe("OG image routes", () => {
  it("share card: 404 for an unknown id, no outside calls", async () => {
    const res = await shareImage(req("/api/share/image/nope"), ctx("nope"));
    expect(res.status).toBe(404);
    expectNoOutsideCalls();
  });
  it("share card: renders a PNG for a real share; cell image fetches stay blocked", async () => {
    const id = await realShare(["Rin"], "OG grid");
    const res = await shareImage(req(`/api/share/image/${id}`), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
  it("compare card: renders a PNG for two real grids", async () => {
    const a = await realShare(["Rin", "Saber"], "A");
    const b = await realShare(["Rin"], "B");
    const res = await compareImage(req(`/api/compare/image?a=${a}&b=${b}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
  });
  it("compare card: 404 when either grid is missing", async () => {
    const id = await realShare(["Rin"], "A");
    expect((await compareImage(req(`/api/compare/image?a=${id}&b=missing`))).status).toBe(404);
  });
  it("share card: Redis failure gives a generic 500 to non-admins", async () => {
    vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("redis exploded"));
    const res = await shareImage(req("/api/share/image/abc"), ctx("abc"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("exploded");
  });
});

describe("server-rendered pages", () => {
  it("/view/[id]: unknown share redirects home", async () => {
    await expect(ViewSharePage({ params: Promise.resolve({ id: "missing" }) })).rejects.toSatisfy(isRedirect);
    expect((await viewMeta({ params: Promise.resolve({ id: "missing" }) })).title).toMatch(/Not Found/);
  });
  it("/view/[id]: existing share renders ViewGrid with its data and OG metadata", async () => {
    const id = await realShare(["Rin", "Saber"], "Page grid");
    const el = (await ViewSharePage({ params: Promise.resolve({ id }) })) as { props: { title: string; shareId: string; grid: unknown[] } };
    expect(el.props.title).toBe("Page grid");
    expect(el.props.shareId).toBe(id);
    const meta = await viewMeta({ params: Promise.resolve({ id }) });
    expect(String(meta.title)).toContain("Page grid");
    expect(JSON.stringify(meta.openGraph)).toContain(id);
  });
  it("/view/[id]: story share redirects to the story view", async () => {
    seedShare("story1", { kind: "story", names: ["Bebop"] });
    await expect(ViewSharePage({ params: Promise.resolve({ id: "story1" }) })).rejects.toSatisfy(isRedirect);
  });
  it("/compare?a&b: two grids are diffed server-side", async () => {
    const a = await realShare(["Rin", "Saber", "Asuna"], "Alpha");
    const b = await realShare(["Rin", "Mikasa"], "Beta");
    const meta = await compareMeta({ searchParams: Promise.resolve({ a, b }) });
    expect(String(meta.title)).toContain("Alpha × Beta");
    const page = await ComparePage({ searchParams: Promise.resolve({ a, b }) });
    expect(JSON.stringify(page, (_k, v) => (typeof v === "function" ? undefined : v))).toContain("Rin");
  });
  it("/compare with a missing grid falls back without throwing", async () => {
    const page = await ComparePage({ searchParams: Promise.resolve({ a: "x1", b: "x2" }) });
    expect(page).toBeTruthy();
  });
});
