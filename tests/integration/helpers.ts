import { NextRequest } from "next/server";
import { USER_ID_HEADER } from "@/lib/user-id";
import { redis } from "./setup";

export const OWNER = "123e4567-e89b-42d3-a456-426614174000";
export const STRANGER = "223e4567-e89b-42d3-a456-426614174001";
export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
export const req = (url: string, init: { method?: string; body?: unknown; user?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url.startsWith("http") ? url : `http://localhost${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.user ? { [USER_ID_HEADER]: init.user } : {}), ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** Writes a v2 share payload straight into the fake Redis (no route involved). */
export function seedShare(id: string, opts: { kind?: "waifu" | "story"; names?: string[]; title?: string; userId?: string | null } = {}) {
  const kind = opts.kind ?? "waifu";
  const names = opts.names ?? ["Rin", "Saber"];
  const grid = names.map((n, i) =>
    kind === "story"
      ? { i, item: { id: 100 + i, type: "ANIME", title: n, cover: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${i}.jpg` } }
      : { i, character: { mal_id: 100 + i, name: n, images: { jpg: { image_url: `https://img.example.com/${i}.jpg` } }, source: "Fate" } },
  );
  const payload = { meta: { v: 2, kind, title: opts.title ?? `Grid ${id}`, userId: opts.userId ?? OWNER, createdAt: new Date(0).toISOString(), size: kind === "story" ? 9 : 100 }, grid };
  redis.strings.set(`waifu100:share:${id}`, JSON.stringify(payload));
  return payload;
}
