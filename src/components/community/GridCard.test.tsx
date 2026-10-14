import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/compare/CompareWithMine", () => ({ CompareWithMine: () => <span data-testid="compare" /> }));

import { GridCard } from "@/components/community/GridCard";

const base = { id: "abc", title: "T", imageUrl: null, createdAt: "2026-01-01T00:00:00.000Z", hasGif: false, count: 5 };

describe("GridCard kinds", () => {
    it("legacy summary (no kind) is a waifu card linking to /view", () => {
        render(<GridCard grid={base} />);
        expect(screen.getByTestId("kind-badge").textContent).toBe("Waifu");
        expect(screen.getByRole("link").getAttribute("href")).toBe("/view/abc");
        expect(screen.getByTestId("compare")).toBeTruthy();
        expect(screen.getByTitle("5 of 100 slots filled")).toBeTruthy();
    });

    it("story summary links to /story/v, shows its size, offers no compare", () => {
        render(<GridCard grid={{ ...base, id: "s1", kind: "story", size: 10 }} />);
        expect(screen.getByTestId("kind-badge").textContent).toBe("Story");
        expect(screen.getByRole("link").getAttribute("href")).toBe("/story/v/s1");
        expect(screen.queryByTestId("compare")).toBeNull();
        expect(screen.getByTitle("5 of 10 slots filled")).toBeTruthy();
    });
});
