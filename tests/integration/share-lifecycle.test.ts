import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { redis, expectNoOutsideCalls } from "./setup";

vi.mock("@/server/text-screen", () => ({ screenUserTexts: vi.fn(async () => true), clearTextScreenCache: () => {} }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: async () => null }));

import { POST as createShare } from "@/app/api/share/route";
import { GET as readShare, PUT as editShare, DELETE as deleteShare } from "@/app/api/share/[id]/route";
import { GET as myGrids } from "@/app/api/my-grids/route";
import { GET as community } from "@/app/api/community/route";
import { USER_ID_HEADER } from "@/lib/user-id";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const STRANGER = "223e4567-e89b-42d3-a456-426614174001";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init: { method?: string; body?: unknown; user?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.user ? { [USER_ID_HEADER]: init.user } : {}) },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
const WAIFU = { kind: "waifu", size: 100, grid: [{ i: 0, m: 5, n: "Rin", img: "https://img.example.com/1.jpg", s: "Fate" }], customTitle: "E2E Mine", userId: OWNER };
const STORY = { kind: "story", size: 9, grid: [{ i: 0, a: 1, t: "ANIME", img: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-x.jpg", n: "Bebop" }], customTitle: "Story Mine", userId: OWNER };

async function create(body: unknown, user = OWNER) {
  const res = await createShare(req("/api/share", { method: "POST", body, user }));
  return { res, json: (await res.json()) as { id?: string; url?: string; error?: string } };
}

describe("share create / read / edit / delete", () => {
  it("creates a waifu share, readable by id, listed in my-grids and community", async () => {
    const { res, json } = await create(WAIFU);
    expect(res.status).toBe(200);
    expect(json.url).toBe(`/view/${json.id}`);
    expect(redis.strings.has(`waifu100:share:${json.id}`)).toBe(true);

    const read = await readShare(req(`/api/share/${json.id}`, { user: OWNER }), ctx(json.id!));
    expect(read.status).toBe(200);
    const shared = await read.json();
    expect(JSON.stringify(shared)).toContain("Rin");

    const mine = await (await myGrids(req("/api/my-grids", { user: OWNER }))).json();
    expect(mine.grids.map((g: { id: string }) => g.id)).toContain(json.id);
    const theirs = await (await myGrids(req("/api/my-grids", { user: STRANGER }))).json();
    expect(theirs.grids).toEqual([]);
    const anon = await (await myGrids(req("/api/my-grids"))).json();
    expect(anon.grids).toEqual([]);

    const feed = await community(req("/api/community?kind=waifu"));
    expect(feed.status).toBe(200);
    expect(JSON.stringify(await feed.json())).toContain(json.id!);
    expectNoOutsideCalls();
  });

  it("story share gets a /story/v url and its own feed", async () => {
    const { res, json } = await create(STORY);
    expect(res.status).toBe(200);
    expect(json.url).toBe(`/story/v/${json.id}`);
    const story = await (await community(req("/api/community?kind=story"))).json();
    expect(JSON.stringify(story)).toContain(json.id!);
  });

  it("owner can edit; stranger cannot", async () => {
    const { json } = await create(WAIFU);
    const edited = await editShare(req(`/api/share/${json.id}`, { method: "PUT", user: OWNER, body: { ...WAIFU, customTitle: "Renamed" } }), ctx(json.id!));
    expect(edited.status).toBe(200);
    const after = await (await readShare(req(`/api/share/${json.id}`), ctx(json.id!))).json();
    expect(JSON.stringify(after)).toContain("Renamed");

    const hijack = await editShare(req(`/api/share/${json.id}`, { method: "PUT", user: STRANGER, body: { ...WAIFU, customTitle: "Hacked" } }), ctx(json.id!));
    expect(hijack.status).toBeGreaterThanOrEqual(400);
    expect(hijack.status).toBeLessThan(500);
    const still = await (await readShare(req(`/api/share/${json.id}`), ctx(json.id!))).json();
    expect(JSON.stringify(still)).not.toContain("Hacked");
  });

  it("owner can delete; stranger cannot", async () => {
    const { json } = await create(WAIFU);
    const no = await deleteShare(req(`/api/share/${json.id}`, { method: "DELETE", user: STRANGER }), ctx(json.id!));
    expect(no.status).toBe(403);
    const yes = await deleteShare(req(`/api/share/${json.id}`, { method: "DELETE", user: OWNER }), ctx(json.id!));
    expect(yes.status).toBe(200);
    const gone = await readShare(req(`/api/share/${json.id}`), ctx(json.id!));
    expect(gone.status).toBe(404);
  });

  describe("error states", () => {
    it("rejects non-JSON and empty bodies with 400", async () => {
      expect((await createShare(req("/api/share", { method: "POST", body: "not json" }))).status).toBe(400);
      expect((await createShare(req("/api/share", { method: "POST", body: "null" }))).status).toBe(400);
    });
    it("rejects a grid that is not an array", async () => {
      const { res } = await create({ ...WAIFU, grid: "nope" });
      expect(res.status).toBe(400);
    });
    it("unknown share id is 404", async () => {
      expect((await readShare(req("/api/share/nope"), ctx("nope"))).status).toBe(404);
    });
    it("community/my-grids return 500 with a generic message when Redis fails", async () => {
      const spy = vi.spyOn(redis, "zrevrange").mockRejectedValue(new Error("boom"));
      const r = await myGrids(req("/api/my-grids", { user: OWNER }));
      expect(r.status).toBe(500);
      expect(JSON.stringify(await r.json())).not.toMatch(/boom|REDIS/);
      spy.mockRestore();
    });
  });
});
