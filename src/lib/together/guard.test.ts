import { describe, expect, it } from "vitest";
import { allowedOrigin, burst, cleanPeerName, clientIp, createGauge, createWindow, messageWithinLimit } from "@/lib/together/guard";

describe("together guard", () => {
    it("allows the site, its previews, and local dev only", () => {
        expect(allowedOrigin("https://waifu100.vercel.app")).toBe(true);
        expect(allowedOrigin("https://waifu100-abc123-salmondevs-projects.vercel.app")).toBe(true);
        expect(allowedOrigin("http://localhost:3100")).toBe(true);
        expect(allowedOrigin("http://127.0.0.1:3310")).toBe(true);
        expect(allowedOrigin("https://evil.example")).toBe(false);
        expect(allowedOrigin("https://waifu100.vercel.app.evil.example")).toBe(false);
        expect(allowedOrigin("http://waifu100.vercel.app")).toBe(false);
        expect(allowedOrigin(null)).toBe(false);
    });

    it("keeps a name a person would type and drops control characters", () => {
        expect(cleanPeerName("  Yuki  ")).toBe("Yuki");
        expect(cleanPeerName("A\nB\u0000C")).toBe("ABC");
        expect(cleanPeerName("x".repeat(40))).toHaveLength(16);
        expect(cleanPeerName(12)).toBe("");
    });

    it("rate window and socket gauge refuse only past the cap", () => {
        const window = createWindow(2, 1000);
        expect(window.allow("a", 0)).toBe(true);
        expect(window.allow("a", 10)).toBe(true);
        expect(window.allow("a", 20)).toBe(false);
        expect(window.allow("a", 1001)).toBe(true);
        const gauge = createGauge(1);
        expect(gauge.take("ip")).toBe(true);
        expect(gauge.take("ip")).toBe(false);
        gauge.release("ip");
        expect(gauge.take("ip")).toBe(true);
    });

    it("a cursor burst above the cap is dropped and a normal message fits", () => {
        const bucket: number[] = [];
        expect(burst(bucket, 2, 1000, 0)).toBe(true);
        expect(burst(bucket, 2, 1000, 10)).toBe(true);
        expect(burst(bucket, 2, 1000, 20)).toBe(false);
        expect(messageWithinLimit("{\"t\":\"cursor\"}")).toBe(true);
        expect(messageWithinLimit("x".repeat(20_000))).toBe(false);
    });

    it("reads the client address from the first forwarded hop", () => {
        expect(clientIp("203.0.113.5, 10.0.0.1", "10.0.0.2")).toBe("203.0.113.5");
        expect(clientIp(null, "10.0.0.2")).toBe("10.0.0.2");
    });
});
