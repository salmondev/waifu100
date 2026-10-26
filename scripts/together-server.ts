// @ts-nocheck
/**
 * Room server for "build grid together".
 * Run with: bun scripts/together-server.ts
 * HTTP create + WebSocket on one port. Rooms live in memory for this process.
 */
import { applyTogetherOp, emptyTogether, type TogetherOp, type TogetherState } from "../src/lib/together/ops";
import {
    MAX_MESSAGE_CHARS,
    MAX_PEERS,
    MAX_ROOM_BODY_CHARS,
    MAX_ROOMS,
    NOISE_PER_SEC,
    OPS_PER_SEC,
    SOCKETS_PER_IP,
    CREATE_LIMIT,
    CREATE_WINDOW_MS,
    UPGRADE_LIMIT,
    UPGRADE_WINDOW_MS,
    adminBearerOk,
    allowedOrigin,
    burst,
    cleanPeerName,
    clientIp,
    corsHeaders,
    createGauge,
    createWindow,
    messageWithinLimit,
} from "../src/lib/together/guard";

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
    opsAt: number[];
    noiseAt: number[];
    /** Stable per browser, so a refresh does not grant a second vote. */
    voterId: string;
}

interface Room {
    code: string;
    ownerToken: string;
    state: TogetherState;
    /** Durable share id, once the host publishes. Lives with the room, not a browser. */
    shareId: string | null;
    createdAt: number;
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
    peers: Map<WebSocket, Peer>;
}

interface SocketData {
    peer?: Peer;
    room?: Room;
    ip?: string;
}

const rooms = new Map<string, Room>();
const creates = createWindow(CREATE_LIMIT, CREATE_WINDOW_MS);
const upgrades = createWindow(UPGRADE_LIMIT, UPGRADE_WINDOW_MS);
const sockets = createGauge(SOCKETS_PER_IP);

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
        showSeen: room.state.showSeen !== false,
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

function ipOf(req: Request, server: { requestIP?: (r: Request) => { address?: string } | null }): string {
    return clientIp(req.headers.get("x-forwarded-for"), server.requestIP?.(req)?.address ?? null);
}

function refuse(status: number, origin: string | null, message: string) {
    return new Response(message, { status, headers: corsHeaders(origin) });
}

Bun.serve<SocketData>({
    port: PORT,
    hostname: "0.0.0.0",
    maxRequestBodySize: MAX_ROOM_BODY_CHARS,
    websocket: {
        maxPayloadLength: MAX_MESSAGE_CHARS,
        open() {},
        message(ws, raw) {
            if (!messageWithinLimit(raw)) return;
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(String(raw));
            } catch {
                return;
            }
            if (!msg || typeof msg !== "object") return;
            if (msg.t === "join") return join(ws, msg);
            const room = ws.data.room;
            const peer = ws.data.peer;
            if (!room || !peer) return;
            if (msg.t === "cursor") {
                if (!burst(peer.noiseAt, NOISE_PER_SEC, 1000)) return;
                const x = Number(msg.x);
                const y = Number(msg.y);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                broadcast(room, { t: "cursor", id: peer.id, name: peer.name, color: peer.color, x, y }, ws);
                return;
            }
            if (msg.t === "hold") {
                if (!burst(peer.noiseAt, NOISE_PER_SEC, 1000)) return;
                const index = msg.index === null ? null : Number(msg.index);
                broadcast(room, { t: "hold", id: peer.id, name: peer.name, color: peer.color, index: Number.isInteger(index) ? index : null }, ws);
                return;
            }
            if (msg.t === "seen") {
                if (!burst(peer.opsAt, OPS_PER_SEC, 1000)) return;
                const i = Number(msg.i);
                let next = null;
                try {
                    next = applyTogetherOp(room.state, { t: "seen", i }, peer.owner, peer.voterId);
                } catch {
                    next = null;
                }
                if (!next) {
                    send(ws, { t: "state", ...publicState(room) });
                    return;
                }
                room.state = next;
                const payload = { t: "state", ...publicState(room) };
                send(ws, payload);
                broadcast(room, payload, ws);
                return;
            }
            if (msg.t === "kick") return kick(room, peer, msg);
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
                if (!burst(peer.opsAt, OPS_PER_SEC, 1000)) return;
                let next: TogetherState | null = null;
                try {
                    next = applyTogetherOp(room.state, msg.op as TogetherOp, peer.owner);
                } catch {
                    next = null;
                }
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
            if (ws.data.ip) sockets.release(ws.data.ip);
            const room = ws.data.room;
            const peer = ws.data.peer;
            if (!room || !peer) return;
            room.peers.delete(ws);
            broadcast(room, { t: "bye", id: peer.id });
        },
    },
    fetch(req, server) {
        const url = new URL(req.url);
        const origin = req.headers.get("origin");
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            if (!allowedOrigin(origin)) return refuse(403, origin, "forbidden");
            const ip = ipOf(req, server);
            if (!upgrades.allow(ip) || !sockets.take(ip)) return refuse(429, origin, "busy");
            if (server.upgrade(req, { data: { ip } })) return undefined;
            sockets.release(ip);
            return new Response("upgrade failed", { status: 400 });
        }
        if (req.method === "OPTIONS") {
            if (!allowedOrigin(origin)) return refuse(403, origin, "forbidden");
            return new Response(null, { headers: corsHeaders(origin) });
        }
        if (req.method === "POST" && url.pathname === "/rooms") {
            return createRoom(req, server);
        }
        if (url.pathname.startsWith("/admin/")) return adminRoute(req, url);
        return new Response("build grid together", { headers: corsHeaders(origin) });
    },
});

function join(ws: WebSocket & { data: SocketData }, msg: Record<string, unknown>) {
    const room = rooms.get(String(msg.code ?? ""));
    if (!room || Date.now() >= room.expiresAt) {
        if (room) endRoom(room.code);
        send(ws, { t: "error", error: "This session has ended." });
        ws.close();
        return;
    }
    if (room.peers.size >= MAX_PEERS) {
        send(ws, { t: "error", error: "This session is full." });
        ws.close();
        return;
    }
    const used = new Set([...room.peers.values()].map((p) => p.name));
    const wanted = cleanPeerName(msg.name);
    const name = wanted && !used.has(wanted) ? wanted : NAMES.find((n) => !used.has(n)) ?? `Guest ${room.peers.size + 1}`;
    const color = COLORS[room.peers.size % COLORS.length];
    const owner = typeof msg.token === "string" && msg.token === room.ownerToken;
    const given = typeof msg.voter === "string" && /^[0-9a-f-]{36}$/i.test(msg.voter) ? msg.voter : "";
    const peer: Peer = { id: crypto.randomUUID(), name, color, owner, opsAt: [], noiseAt: [], voterId: given || crypto.randomUUID() };
    room.peers.set(ws, peer);
    ws.data.peer = peer;
    ws.data.room = room;
    send(ws, { t: "welcome", self: { id: peer.id, name, color, owner }, state: publicState(room), peers: peerList(room) });
    broadcast(room, { t: "peers", peers: peerList(room) }, ws);
}

/** Drops one connection. They can open the link again; nothing is remembered. */
function dropPeer(room: Room, id: string) {
    for (const [sock, other] of room.peers) {
        if (other.id !== id) continue;
        send(sock, { t: "kicked" });
        sock.close();
        return true;
    }
    return false;
}

/** Host drops one connection. The person can open the link again; nothing is remembered. */
function kick(room: Room, peer: Peer, msg: Record<string, unknown>) {
    if (!peer.owner) return;
    const id = typeof msg.id === "string" ? msg.id : "";
    if (!id || id === peer.id || id.length > 80) return;
    dropPeer(room, id);
}

function adminSecret(): string {
    return (process.env.TOGETHER_ADMIN_TOKEN ?? "").trim();
}

function roomAdminRow(room: Room) {
    return {
        code: room.code,
        kind: room.state.kind ?? "story",
        title: room.state.title || "Untitled grid",
        size: room.state.size,
        filled: room.state.items.filter(Boolean).length,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt,
        shareId: room.shareId,
        peers: [...room.peers.values()].map(({ id, name, owner }) => ({ id, name, owner })),
    };
}

/** Local desk only. The bearer is the secret; there is no browser origin on this path. */
async function adminRoute(req: Request, url: URL): Promise<Response> {
    const secret = adminSecret();
    if (!secret) return new Response("not found", { status: 404 });
    if (!adminBearerOk(req.headers.get("authorization"), secret)) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (req.method === "GET" && url.pathname === "/admin/rooms") {
        const roomsOut = [...rooms.values()]
            .map(roomAdminRow)
            .sort((a, b) => b.createdAt - a.createdAt);
        return Response.json({ rooms: roomsOut });
    }
    if (req.method !== "POST") return new Response("not found", { status: 404 });
    let body: { code?: unknown; id?: unknown } = {};
    try {
        body = (await req.json()) as { code?: unknown; id?: unknown };
    } catch {
        return Response.json({ error: "Invalid request." }, { status: 400 });
    }
    const code = typeof body.code === "string" ? body.code : "";
    const room = rooms.get(code);
    if (!room) return Response.json({ error: "That session has already ended." }, { status: 404 });
    if (url.pathname === "/admin/rooms/end") {
        endRoom(code);
        return Response.json({ ok: true, code });
    }
    if (url.pathname === "/admin/rooms/kick") {
        const id = typeof body.id === "string" ? body.id : "";
        if (!id || id.length > 80) return Response.json({ error: "Unknown person." }, { status: 400 });
        if (!dropPeer(room, id)) return Response.json({ error: "That person already left." }, { status: 404 });
        return Response.json({ ok: true, code, id });
    }
    return new Response("not found", { status: 404 });
}

async function createRoom(req: Request, server: { requestIP?: (r: Request) => { address?: string } | null }): Promise<Response> {
    const origin = req.headers.get("origin");
    const headers = corsHeaders(origin);
    if (!allowedOrigin(origin)) return new Response("forbidden", { status: 403, headers });
    if (!creates.allow(ipOf(req, server))) return new Response(JSON.stringify({ error: "Too many rooms." }), { status: 429, headers });
    if (rooms.size >= MAX_ROOMS) return new Response(JSON.stringify({ error: "Busy." }), { status: 503, headers });
    const text = await req.text().catch(() => "");
    if (text.length > MAX_ROOM_BODY_CHARS) return new Response("too large", { status: 413, headers });
    let body: { kind?: unknown } | null = null;
    try {
        body = text ? JSON.parse(text) as { kind?: unknown } : null;
    } catch {
        body = null;
    }
    const kind = body?.kind === "waifu" ? "waifu" : "story";
    const base = emptyTogether(undefined, null, "", kind);
    let id = code();
    while (rooms.has(id)) id = code();
    const ownerToken = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + SESSION_MS;
    const timer = setTimeout(() => endRoom(id), SESSION_MS);
    rooms.set(id, { code: id, ownerToken, state: base, shareId: null, createdAt, expiresAt, timer, peers: new Map() });
    return Response.json({ code: id, ownerToken }, { headers });
}

console.log(`build grid together  ws://127.0.0.1:${PORT}`);
