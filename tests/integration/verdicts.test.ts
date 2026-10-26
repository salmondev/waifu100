import { describe, expect, it, vi } from "vitest";
import { gemini, expectNoOutsideCalls } from "./setup";
import { OWNER, STRANGER, req } from "./helpers";

vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: async () => null }));
vi.mock("@/server/text-screen", () => ({ screenUserTexts: vi.fn(async () => true), clearTextScreenCache: () => {} }));
import { POST as createShare } from "@/app/api/share/route";
import { POST as compareVerdict } from "@/app/api/compare/verdict/route";
import { POST as storyVerdict, PATCH as storyVote } from "@/app/api/story/verdict/route";
import { STORY_VERDICT_ENABLED } from "@/lib/story/config";

const VERDICT = { en: { title: "Pair", content: "You two.", tags: ["#x"] }, th: { title: "คู่", content: "ทั้งสองคน", tags: ["#y"] }, emoji: "🔥" };
const ok = () => gemini.generateContent.mockResolvedValue({ response: Promise.resolve({ text: () => JSON.stringify(VERDICT) }) });

async function mk(body: object, user = OWNER) {
  const r = await createShare(req("/api/share", { method: "POST", user, body: { userId: user, ...body } }));
  return ((await r.json()) as { id: string }).id;
}
const waifu = (names: string[]) => mk({ kind: "waifu", size: 100, customTitle: names.join(","), grid: names.map((n, i) => ({ i, m: 50 + i, n, img: `https://img.example.com/${i}.jpg` })) });
const story = (titles: string[]) => mk({ kind: "story", size: 9, customTitle: "S", grid: titles.map((t, i) => ({ i, a: 1 + i, t: "ANIME", n: t, img: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${i}.jpg` })) });

describe("compare verdict (two grids)", () => {
  it("generated once, then served from cache", async () => {
    ok();
    const a = await waifu(["Rin", "Saber"]);
    const b = await waifu(["Rin", "Asuna"]);
    const first = await (await compareVerdict(req("/api/compare/verdict", { method: "POST", body: { a, b } }))).json();
    const second = await (await compareVerdict(req("/api/compare/verdict", { method: "POST", body: { a, b } }))).json();
    expect(first.cached).toBeFalsy();
    expect(second.cached).toBe(true);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    expectNoOutsideCalls();
  });
  it("error states: same id twice 400, missing grid 404", async () => {
    const a = await waifu(["Rin"]);
    expect((await compareVerdict(req("/api/compare/verdict", { method: "POST", body: { a, b: a } }))).status).toBe(400);
    expect((await compareVerdict(req("/api/compare/verdict", { method: "POST", body: { a, b: "zzzzzzzz" } }))).status).toBe(404);
  });
});

describe.skipIf(!STORY_VERDICT_ENABLED)("story verdict: once, disagree -> regenerate", () => {
  it("first call generates, second is cached, owner disagree then regenerates", async () => {
    ok();
    const id = await story(["Bebop", "Frieren"]);
    const v1 = await (await storyVerdict(req("/api/story/verdict", { method: "POST", user: OWNER, body: { shareId: id } }))).json();
    expect(v1.cached).toBe(false);
    const v2 = await (await storyVerdict(req("/api/story/verdict", { method: "POST", user: STRANGER, body: { shareId: id } }))).json();
    expect(v2.cached).toBe(true);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);

    expect((await storyVote(req("/api/story/verdict", { method: "PATCH", user: STRANGER, body: { shareId: id, feedback: "disagree" } }))).status).toBe(403);
    expect((await storyVote(req("/api/story/verdict", { method: "PATCH", user: OWNER, body: { shareId: id, feedback: "disagree" } }))).status).toBe(200);
    // stranger still sees the stored one; owner gets a fresh one
    expect((await (await storyVerdict(req("/api/story/verdict", { method: "POST", user: STRANGER, body: { shareId: id } }))).json()).cached).toBe(true);
    const v3 = await (await storyVerdict(req("/api/story/verdict", { method: "POST", user: OWNER, body: { shareId: id } }))).json();
    expect(v3.cached).toBe(false);
    expect(gemini.generateContent).toHaveBeenCalledTimes(2);
  });
  it("error states: bad id 400, no verdict to vote on 404", async () => {
    expect((await storyVerdict(req("/api/story/verdict", { method: "POST", body: { shareId: 5 } }))).status).toBe(400);
    const id = await story(["Bebop"]);
    expect((await storyVote(req("/api/story/verdict", { method: "PATCH", user: OWNER, body: { shareId: id, feedback: "agree" } }))).status).toBe(404);
  });
});
