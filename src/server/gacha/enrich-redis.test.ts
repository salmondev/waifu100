import { describe, expect, it } from "vitest";
import { READ_ONLY_COMMANDS, readOnly } from "../../../scripts/gacha/enrich/lib/redis-readonly.mjs";

function fakeClient() {
    const calls: string[] = [];
    const client: Record<string, (...args: unknown[]) => string> = {};
    for (const cmd of [...READ_ONLY_COMMANDS, "set", "del", "flushall", "expire", "eval", "quit"]) {
        client[cmd] = () => {
            calls.push(cmd);
            return "ok";
        };
    }
    return { client, calls };
}

describe("readOnly Redis view", () => {
    it("forwards scan and get, and refuses set and del before they reach the client", () => {
        const { client, calls } = fakeClient();
        const view = readOnly(client) as Record<string, (...args: unknown[]) => string>;
        expect(view.scan("0", "MATCH", "waifu100:share:*", "COUNT", 10)).toBe("ok");
        expect(view.get("waifu100:share:1")).toBe("ok");
        expect(() => view.set("waifu100:share:1", "x")).toThrow(/set/);
        expect(() => view.del("waifu100:share:1")).toThrow(/del/);
        expect(() => view.flushall()).toThrow(/flushall/);
        expect(calls).toEqual(["scan", "get"]);
    });

    it("still allows quit so the connection can close", () => {
        const { client, calls } = fakeClient();
        const view = readOnly(client) as Record<string, (...args: unknown[]) => string>;
        expect(view.quit()).toBe("ok");
        expect(calls).toEqual(["quit"]);
    });
});
