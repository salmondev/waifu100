// @ts-nocheck
/**
 * Local room server for "build grid together".
 * Run with: bun scripts/together-server.ts
 * HTTP create + WebSocket on port 3310. Rooms live in memory for this process.
 */
import { applyTogetherOp, emptyTogether, type TogetherOp, type TogetherState } from "../src/lib/together/ops";

const PORT = Number(process.env.PORT) || 3310;
/** A room lasts six hours from the moment it is opened, then it is dropped. */
const SESSION_MS = 6 * 60 * 60 * 1000;
const COLORS = ["#f472b6", "#a78bfa", "#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#c084fc"];
const NAMES = ["Momo", "Kira", "Ren", "Sora", "Yuki", "Hana", "Nico", "Ao", "Rin", "Kai", "Jun", "Mika"];

interface Peer {
    id: string;
    name: string;
    color: string;
    owner: boolean;
}

interface Room {
    code: string;
    ownerToken: string;
    state: TogetherState;
    /** Durable share id, once the host publishes. Lives with the room, not a browser. */
    shareId: string | null;
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
    peers: Map<WebSocket, Peer>;
}

const rooms = new Map<string, Room>();

function code(): string {
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
}

function send(ws: WebSocket, msg: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: unknown, except?: WebSocket) {
    for (const ws of room.peers.keys()) {
        if (ws !== except) send(ws, msg);
    }
}

function peerList(room: Room) {
    return [...room.peers.values()].map(({ id, name, color, owner }) => ({ id, name, color, owner }));
}

function publicState(room: Room) {
    return {
        kind: room.state.kind ?? "story",
        size: room.state.size,
        cols: room.state.cols ?? null,
        title: room.state.title ?? "",
        titleStyle: room.state.titleStyle ?? "overlay",
        items: room.state.items,
        shareId: room.shareId,
        expiresAt: room.expiresAt,
    };
}

function endRoom(code: string) {
    const room = rooms.get(code);
    if (!room) return;
    clearTimeout(room.timer);
    for (const ws of room.peers.keys()) {
        send(ws, { t: "ended" });
        ws.close();
    }
    rooms.delete(code);
}

Bun.serve<{ peer?: Peer; room?: Room }>({
    port: PORT,
    hostname: "0.0.0.0",
    fetch(req, server) {
        const url = new URL(req.url);
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            if (server.upgrade(req, { data: {} })) return undefined;
            return new Response("upgrade failed", { status: 400 });
        }
        if (req.method === "OPTIONS") {
            return new Response(null, { headers: cors() });
        }
        if (req.method === "POST" && url.pathname === "/rooms") {
            return createRoom(req);
        }
        return new Response("build grid together", { headers: cors() });
    },
    websocket: {
        open() {},
        message(ws, raw) {
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(String(raw));
            } catch {
                return;
            }
            if (msg.t === "join") return join(ws, msg);
            const room = ws.data.room;
            const peer = ws.data.peer;
            if (!room || !peer) return;
            if (msg.t === "cursor") {
                const x = Number(msg.x);
                const y = Number(msg.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                broadcast(room, { t: "cursor", id: peer.id, name: peer.name, color: peer.color, x, y }, ws);
                return;
            }
            if (msg.t === "hold") {
                const index = msg.index === null ? null : Number(msg.index);
                broadcast(room, { t: "hold", id: peer.id, name: peer.name, color: peer.color, index: Number.isInteger(index) ? index : null }, ws);
                return;
            }
            if (msg.t === "published" && peer.owner) {
                const id = typeof msg.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(msg.id) ? msg.id : null;
                if (!id) return;
                room.shareId = id;
                const published = { t: "state", ...publicState(room) };
                send(ws, published);
                broadcast(room, published, ws);
                return;
            }
            if (msg.t === "op") {
                const next = applyTogetherOp(room.state, msg.op as TogetherOp, peer.owner);
                if (!next) {
                    send(ws, { t: "state", ...publicState(room) });
                    return;
                }
                room.state = next;
                const payload = { t: "state", ...publicState(room) };
                send(ws, payload);
                broadcast(room, payload, ws);
            }
        },
        close(ws) {
            const room = ws.data.room;
            const peer = ws.data.peer;
            if (!room || !peer) return;
            room.peers.delete(ws);
            broadcast(room, { t: "bye", id: peer.id });
        },
    },
});

function join(ws: WebSocket & { data: { peer?: Peer; room?: Room } }, msg: Record<string, unknown>) {
    const room = rooms.get(String(msg.code ?? ""));
    if (!room || Date.now() >= room.expiresAt) {
        if (room) endRoom(room.code);
        send(ws, { t: "error", error: "This session has ended." });
        ws.close();
        return;
    }
    const used = new Set([...room.peers.values()].map((p) => p.name));
    const wanted = typeof msg.name === "string" ? msg.name.slice(0, 16).trim() : "";
    const name = wanted && !used.has(wanted) ? wanted : NAMES.find((n) => !used.has(n)) ?? `Guest ${room.peers.size + 1}`;
    const color = COLORS[room.peers.size % COLORS.length];
    const owner = typeof msg.token === "string" && msg.token === room.ownerToken;
    const peer: Peer = { id: crypto.randomUUID(), name, color, owner };
    room.peers.set(ws, peer);
    ws.data.peer = peer;
    ws.data.room = room;
    send(ws, { t: "welcome", self: peer, state: publicState(room), peers: peerList(room) });
    broadcast(room, { t: "peers", peers: peerList(room) }, ws);
}

async function createRoom(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
    const kind = body?.kind === "waifu" ? "waifu" : "story";
    const base = emptyTogether(undefined, null, "", kind);
    let id = code();
    while (rooms.has(id)) id = code();
    const ownerToken = crypto.randomUUID();
    const expiresAt = Date.now() + SESSION_MS;
    const timer = setTimeout(() => endRoom(id), SESSION_MS);
    rooms.set(id, { code: id, ownerToken, state: base, shareId: null, expiresAt, timer, peers: new Map() });
    return Response.json({ code: id, ownerToken }, { headers: cors() });
}

function cors(): HeadersInit {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

console.log(`build grid together  ws://127.0.0.1:${PORT}`);
