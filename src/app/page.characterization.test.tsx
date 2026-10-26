import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Home from "./page";

/**
 * Characterization tests (T-0009 item 1): lock the current waifu builder
 * behaviour before its grid moves onto the shared grid component.
 */
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
    usePathname: () => "/",
}));

const char = (n: number, extra: Record<string, unknown> = {}) => ({
    mal_id: n,
    name: `Char ${n}`,
    images: { jpg: { image_url: `https://cdn.example.com/${n}.jpg` } },
    source: "Show",
    ...extra,
});

function seed(cells: Record<number, ReturnType<typeof char>>, wrapped = true) {
    const grid = Array.from({ length: 100 }, (_, i) => ({ character: cells[i] ?? null }));
    localStorage.setItem("waifu100-grid", JSON.stringify(wrapped ? { grid, verdict: null, verdictFeedback: null } : grid));
}

function gridEl(container: HTMLElement) {
    return container.querySelector('[data-waifu-grid], .grid.grid-cols-10') as HTMLElement;
}

beforeEach(() => {
    localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ grids: [] }), { status: 200 }));
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("waifu builder (characterization)", () => {
    it("always renders exactly 100 slots", () => {
        const { container } = render(<Home />);
        expect(gridEl(container).children).toHaveLength(100);
    });

    it("restores a saved draft (wrapped object) into the right slots", async () => {
        seed({ 0: char(1), 57: char(2, { customImageUrl: "https://img.example.com/custom.png" }) });
        const { container, findByAltText } = render(<Home />);
        await findByAltText("Char 1");
        const cells = gridEl(container).children;
        expect(cells[0].querySelector("img")?.getAttribute("alt")).toBe("Char 1");
        expect(cells[57].querySelector("img")?.getAttribute("alt")).toBe("Char 2");
        expect(cells[1].querySelector("img")).toBeNull();
        // Custom image wins and every remote image goes through the moderated proxy.
        expect(cells[57].querySelector("img")?.getAttribute("src")).toBe(
            `/api/img?u=${encodeURIComponent("https://img.example.com/custom.png")}&w=384`
        );
        expect(cells[0].querySelector("img")?.getAttribute("src")?.startsWith("/api/img?u=")).toBe(true);
    });

    it("restores the legacy bare-array draft too", async () => {
        seed({ 99: char(9) }, false);
        const { container, findByAltText } = render(<Home />);
        await findByAltText("Char 9");
        expect(gridEl(container).children[99].querySelector("img")?.getAttribute("alt")).toBe("Char 9");
    });

    it("empty slots show their 1-based number", () => {
        const { container } = render(<Home />);
        const cells = gridEl(container).children;
        expect(cells[0].textContent).toContain("1");
        expect(cells[99].textContent).toContain("100");
    });

    it("persists the grid back to localStorage in the wrapped shape", async () => {
        seed({ 3: char(3) });
        const { findByAltText } = render(<Home />);
        await findByAltText("Char 3");
        const saved = JSON.parse(localStorage.getItem("waifu100-grid")!);
        expect(saved.grid).toHaveLength(100);
        expect(saved.grid[3].character.name).toBe("Char 3");
        expect(saved).toHaveProperty("verdict");
    });
});
