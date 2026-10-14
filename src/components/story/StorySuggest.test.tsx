import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StorySuggest } from "./StorySuggest";
import type { StoryItem } from "@/lib/share-schema";

const it_ = (id: number, title: string) => ({ src: "anilist", id, type: "ANIME", title, cover: "https://s4.anilist.co/x.jpg" }) as StoryItem;
const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("StorySuggest (parity item 5)", () => {
    it("never fetches on mount or when the board changes - only on an explicit click, once", async () => {
        const f = ok({ suggestions: [] });
        vi.stubGlobal("fetch", f);
        const { rerender } = render(<StorySuggest items={[it_(1, "A"), it_(2, "B")]} onPick={() => {}} />);
        rerender(<StorySuggest items={[it_(1, "A"), it_(2, "B"), it_(3, "C")]} onPick={() => {}} />);
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        expect(f).not.toHaveBeenCalled();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Generate Ideas/ })); });
        expect(f).toHaveBeenCalledTimes(1);
        expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ kind: "story", characterNames: ["A", "B", "C"] });
    });

    it("renders no model URLs/images; picking a suggestion hands over only its title", async () => {
        vi.stubGlobal("fetch", ok({ suggestions: [{ title: "Frieren", type: "ANIME", reason: "r", image: "https://evil.example/x.png" }, { title: "https://evil.example", type: "ANIME" }] }));
        const onPick = vi.fn();
        const { container } = render(<StorySuggest items={[it_(1, "A"), it_(2, "B")]} onPick={onPick} />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Generate Ideas/ })); });
        expect(container.querySelector("img")).toBeNull();
        expect(container.innerHTML).not.toContain("evil");
        fireEvent.click(await screen.findByRole("button", { name: /Frieren/ }));
        expect(onPick).toHaveBeenCalledWith("Frieren");
    });

    it("quota error shows a friendly message and does not retry", async () => {
        const f = ok({ code: "ai_busy", error: "The AI is busy right now. Please try again in a few minutes." }, 503);
        vi.stubGlobal("fetch", f);
        render(<StorySuggest items={[it_(1, "A"), it_(2, "B")]} onPick={() => {}} />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Generate Ideas/ })); });
        expect((await screen.findByRole("alert")).textContent).toBe("The AI is busy right now. Please try again in a few minutes.");
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("hides itself when AI isn't configured", async () => {
        vi.stubGlobal("fetch", ok({ code: "ai_unavailable", error: "x" }, 503));
        render(<StorySuggest items={[it_(1, "A"), it_(2, "B")]} onPick={() => {}} />);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Generate Ideas/ })); });
        expect(screen.queryByRole("button", { name: /Generate Ideas/ })).toBeNull();
    });
});
