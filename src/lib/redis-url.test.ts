import { describe, expect, it } from "vitest";
import { redisOptionsFromUrl } from "@/lib/redis";

describe("redisOptionsFromUrl (no url.parse, DEP0169)", () => {
    it.each([
        ["redis://127.0.0.1:6379", { host: "127.0.0.1", port: 6379 }],
        ["redis://localhost", { host: "localhost", port: 6379 }],
        ["redis://default:p%40ss@db.example.com:1234/2", { host: "db.example.com", port: 1234, username: "default", password: "p@ss", db: 2 }],
        ["rediss://:secret@h.upstash.io:6380", { host: "h.upstash.io", port: 6380, password: "secret", tls: { servername: "h.upstash.io" } }],
        ["redis://[::1]:6379", { host: "::1", port: 6379 }],
    ])("%s", (url, expected) => {
        expect(redisOptionsFromUrl(url)).toEqual(expected);
    });
    it("rejects other schemes", () => {
        expect(() => redisOptionsFromUrl("http://x")).toThrow();
    });
});
