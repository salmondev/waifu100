import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryVerdict, StoryViewVerdict } from "@/components/story/StoryExtras";

const it2 = (id: number) => ({ id, type: "ANIME" as const, title: `T${id}`, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" as const });
const VERDICT = { emoji: "🌸", en: { title: "Soft Heart", content: "You like gentle stories.", tags: ["#cozy"] }, th: { title: "ใจนุ่ม", content: "ชอบเรื่องอบอุ่น", tags: ["#อบอุ่น"] } };
const mock = (impl: () => Promise<Response>) => { const f = vi.fn(impl); vi.stubGlobal("fetch", f); return f; };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("builder verdict = waifu's Ask AI button + AnalysisModal", () => {
    it("disabled under 2 titles; no fetch on mount", async () => {
        const f = mock(async () => new Response("{}"));
        render(<StoryVerdict items={[it2(1)]} />);
        expect((screen.getByRole("button", { name: /Ask AI About My Taste/ }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        expect(f).not.toHaveBeenCalled();
    });
    it("opens the modal: waifu loading copy, then the verdict card (Thai first) with Agree/Disagree; story payload", async () => {
        let release!: (r: Response) => void;
        const f = mock(() => new Promise<Response>((r) => { release = r; }));
        render(<StoryVerdict items={[it2(1), it2(2), null]} />);
        fireEvent.click(screen.getByRole("button", { name: /Ask AI About My Taste/ }));
        expect(await screen.findByText("Reading Your Vibes...")).toBeTruthy();
        expect(f).toHaveBeenCalledTimes(1);
        expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ characterNames: ["T1 (anime)", "T2 (anime)"], kind: "story" });
        await act(async () => { release(new Response(JSON.stringify(VERDICT))); });
        expect(await screen.findByText(/ใจนุ่ม/)).toBeTruthy();
        expect(screen.getByText("Vibe Check")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Agree" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Disagree" })).toBeTruthy();
    });
    it("error: waifu's red error state with Try Again (re-runs)", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const f = mock(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
        render(<StoryVerdict items={[it2(1), it2(2)]} />);
        fireEvent.click(screen.getByRole("button", { name: /Ask AI About My Taste/ }));
        await screen.findByText("Something went wrong. The AI needed a break. Try again later.");
        fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
        await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    });
});

describe("view verdict = waifu ViewGrid header button + read-only modal", () => {
    it("✨ Generate AI Verdict -> Generating... -> read-only modal; then 'AI Verdict' reopens without a refetch", async () => {
        let release!: (r: Response) => void;
        const f = mock(() => new Promise<Response>((r) => { release = r; }));
        render(<StoryViewVerdict items={[it2(1)]} sharePath="/story/v/x" />);
        fireEvent.click(screen.getByRole("button", { name: /Generate AI Verdict/ }));
        expect(await screen.findByText("Generating...")).toBeTruthy();
        await act(async () => { release(new Response(JSON.stringify(VERDICT))); });
        expect(await screen.findByText(/ใจนุ่ม/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Agree" })).toBeNull(); // readonly, like waifu's shared view
        expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
        fireEvent.click(screen.getByTestId("story-verdict"));
        expect(screen.getByTestId("story-verdict").textContent).toBe("AI Verdict");
        expect(f).toHaveBeenCalledTimes(1);
    });
    it("failure: like waifu, no modal and the button comes back", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mock(async () => new Response("{}", { status: 500 }));
        render(<StoryViewVerdict items={[it2(1)]} />);
        fireEvent.click(screen.getByRole("button", { name: /Generate AI Verdict/ }));
        await waitFor(() => expect(screen.getByRole("button", { name: /Generate AI Verdict/ })).toBeTruthy());
        expect(screen.queryByText("Reading Your Vibes...")).toBeNull();
    });
    it("hidden when story verdicts are off (403)", async () => {
        mock(async () => new Response("{}", { status: 403 }));
        render(<StoryViewVerdict items={[it2(1)]} />);
        fireEvent.click(screen.getByRole("button", { name: /Generate AI Verdict/ }));
        await waitFor(() => expect(screen.queryByTestId("story-verdict")).toBeNull());
    });
});
