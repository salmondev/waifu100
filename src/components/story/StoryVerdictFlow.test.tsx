import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let mine: { id: string; title: string; kind?: "story" | "waifu"; count: number; size?: number; imageUrl: null; createdAt: string; hasGif: boolean }[] = [];
vi.mock("@/lib/my-grids", () => ({ useMyGrids: () => mine }));
const toBlob = vi.fn(async (..._a: unknown[]) => new Blob(["png"], { type: "image/png" }));
vi.mock("html-to-image", () => ({ toBlob: (...a: unknown[]) => toBlob(...a) }));

import { StoryVerdict, StoryViewVerdict } from "@/components/story/StoryExtras";
import { StoryVerdictCard } from "@/components/story/StoryVerdictCard";
import { StoryCompareWithMine } from "@/components/story/StoryCompareWithMine";
import { comparePathFor } from "@/components/compare/CompareBar";
import { saveLocalVerdict } from "@/lib/story/verdict-client";
import { storyVerdictTitles } from "@/lib/story/verdict-titles";

const item = (id: number, type = "ANIME") => ({ id, type: type as "ANIME", title: `T${id}`, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" as const });
const V = (t: string) => ({ emoji: "🌸", en: { title: t, content: "You like gentle stories.", tags: ["#cozy"] }, th: { title: `th-${t}`, content: "ชอบเรื่องอบอุ่น", tags: ["#อบอุ่น"] } });
let fetchMock: ReturnType<typeof vi.fn>;
const calls = () => fetchMock.mock.calls.map((c) => ({ url: String(c[0]), method: (c[1] as RequestInit | undefined)?.method, body: (c[1] as RequestInit | undefined)?.body ? JSON.parse(String((c[1] as RequestInit).body)) : undefined }));
beforeEach(() => {
    mine = [];
    localStorage.clear();
    toBlob.mockClear();
    fetchMock = vi.fn(async () => new Response(JSON.stringify(V("First"))));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
const board = [item(1), item(2), item(3)];
const openBuilder = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Ask AI About My Taste/ }));
    await screen.findAllByText(/th-/);
};
const closeModal = () => fireEvent.click(document.querySelector(".fixed.inset-0 button") as HTMLButtonElement);

describe("builder verdict: generated once, regenerated only after Disagree", () => {
    it("reopen and reload reuse the verdict (one AI call)", async () => {
        const { unmount } = render(<StoryVerdict items={board} />);
        await openBuilder();
        closeModal();
        await openBuilder();
        unmount();
        render(<StoryVerdict items={board} />);
        await act(async () => {});
        await openBuilder();
        expect(calls().filter((c) => c.url === "/api/analyze")).toHaveLength(1);
    });
    it("Agree keeps it; Disagree makes the next open generate a new one", async () => {
        render(<StoryVerdict items={board} />);
        await openBuilder();
        fireEvent.click(screen.getByRole("button", { name: "Agree" }));
        closeModal();
        await openBuilder();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Disagree" }));
        closeModal();
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(V("Second"))));
        await openBuilder();
        await screen.findAllByText(/th-Second/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("a changed board is a new verdict (the old one is never shown for it)", async () => {
        const { rerender } = render(<StoryVerdict items={board} />);
        await openBuilder();
        closeModal();
        rerender(<StoryVerdict items={[...board, item(4)]} />);
        await act(async () => {});
        await openBuilder();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe("view verdict: stored on the share", () => {
    it("a stored verdict opens with no request", async () => {
        render(<StoryViewVerdict shareId="s1" items={board} initialVerdict={V("Stored")} />);
        expect(screen.getByTestId("story-verdict").textContent).toBe("AI Verdict");
        fireEvent.click(screen.getByTestId("story-verdict"));
        await screen.findAllByText(/th-Stored/);
        expect(screen.queryByRole("button", { name: "Disagree" })).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it("owner votes (PATCH); after Disagree the button regenerates via the server", async () => {
        mine = [{ id: "s1", title: "Mine", kind: "story", count: 3, size: 9, imageUrl: null, createdAt: "", hasGif: false }];
        fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
            new Response(init?.method === "PATCH" ? "{}" : JSON.stringify({ verdict: V("Second"), feedback: null })));
        render(<StoryViewVerdict shareId="s1" items={board} initialVerdict={V("Stored")} />);
        fireEvent.click(screen.getByTestId("story-verdict"));
        await screen.findAllByText(/th-Stored/);
        fireEvent.click(screen.getByRole("button", { name: "Disagree" }));
        expect(calls()[0]).toMatchObject({ url: "/api/story/verdict", method: "PATCH", body: { shareId: "s1", feedback: "disagree" } });
        closeModal();
        expect(screen.getByTestId("story-verdict").textContent).toBe("New AI Verdict");
        fireEvent.click(screen.getByTestId("story-verdict"));
        await screen.findAllByText(/th-Second/);
        expect(calls()[1]).toMatchObject({ url: "/api/story/verdict", method: "POST", body: { shareId: "s1" } });
    });
    it("owner's builder verdict for the same board is carried onto the share, no AI call", async () => {
        mine = [{ id: "s1", title: "Mine", kind: "story", count: 3, size: 9, imageUrl: null, createdAt: "", hasGif: false }];
        saveLocalVerdict(storyVerdictTitles(board), V("Local"), "agree");
        fetchMock.mockResolvedValue(new Response("{}"));
        render(<StoryViewVerdict shareId="s1" items={board} />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(calls()[0]).toMatchObject({ url: "/api/story/verdict", method: "POST", body: { shareId: "s1", feedback: "agree", verdict: { en: { title: "Local" } } } });
        expect(screen.getByTestId("story-verdict").textContent).toBe("AI Verdict");
    });
});

describe("exported verdict image has no controls", () => {
    it("the share card renders no buttons, inputs or links, and names grid + brand", () => {
        render(<StoryVerdictCard result={V("Pretty")} lang="th" gridTitle="My Picks" host="waifu100.vercel.app" />);
        const card = screen.getByTestId("story-verdict-card");
        expect(card.querySelectorAll("button, input, a, select, textarea")).toHaveLength(0);
        expect(card.textContent).toContain("th-Pretty");
        expect(card.textContent).toContain("My Picks");
        expect(card.textContent).toContain("Story100");
        expect(card.textContent).not.toMatch(/Agree|Disagree|Copy|Save Image|Share|EN|TH/);
    });
    it("Save Image renders the off-screen share card (not the modal) at 2x", async () => {
        URL.createObjectURL = vi.fn(() => "blob:x");
        URL.revokeObjectURL = vi.fn();
        render(<StoryViewVerdict shareId="s1" items={board} initialVerdict={V("Stored")} gridTitle="My Picks" />);
        fireEvent.click(screen.getByTestId("story-verdict"));
        await screen.findAllByText(/th-Stored/);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save Image" })); });
        await waitFor(() => expect(toBlob).toHaveBeenCalled());
        const [node, opts] = toBlob.mock.calls[0] as [HTMLElement, { pixelRatio: number; style: Record<string, string> }];
        expect(node.id).toBe("story-verdict-export");
        expect(node.querySelectorAll("button")).toHaveLength(0);
        expect(opts.pixelRatio).toBe(2);
        expect(opts.style.position).toBe("static");
    });
});

describe("compare entry points (story-only; waifu paths unchanged)", () => {
    const g = (id: string, kind?: "story" | "waifu") => ({ id, title: id, kind, count: 1, imageUrl: null, createdAt: "", hasGif: false });
    it("CompareBar: waifu pairs keep /compare, story pairs go to /story/compare", () => {
        expect(comparePathFor(g("a"), g("b"))).toBe("/compare?a=a&b=b");
        expect(comparePathFor(g("a", "waifu"), g("b", "waifu"))).toBe("/compare?a=a&b=b");
        expect(comparePathFor(g("a", "story"), g("b", "story"))).toBe("/story/compare?a=a&b=b");
    });
    it("StoryCompareWithMine: no own grids -> picker; one -> direct; never waifu grids", () => {
        mine = [g("w1", "waifu") as never];
        const { unmount } = render(<StoryCompareWithMine shareId="x" />);
        expect(screen.getByRole("link", { name: /Compare with another grid/ }).getAttribute("href")).toBe("/story/compare?b=x");
        unmount();
        mine = [g("w1", "waifu") as never, g("s1", "story") as never];
        render(<StoryCompareWithMine shareId="x" />);
        expect(screen.getByRole("link", { name: /Compare with my grid/ }).getAttribute("href")).toBe("/story/compare?a=s1&b=x");
    });
});
