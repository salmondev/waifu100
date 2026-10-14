import { NextRequest, NextResponse } from "next/server";
import { featureUnavailable } from "@/lib/public-errors";
import { put } from "@vercel/blob";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { moderateBytes } from "@/server/moderation/moderator";

export const runtime = "nodejs";

/** Under Vercel's 4.5 MB function body limit; the client re-encodes larger files. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Waifu share uploads (grid thumbnail, custom cell images).
 * T-0009 review M1: this used to hand out client Blob tokens with no check and
 * no limit. Now the server receives the bytes, rate-limits per IP, moderates
 * them, and stores exactly the checked bytes under their sha256. Fails closed.
 */
export async function POST(req: NextRequest) {
    const limited = await enforceRateLimit(req, LIMITS.upload);
    if (limited) return limited;

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: "Max 4 MB" }, { status: 413 });
    const ext = TYPES[file.type];
    if (!ext) return NextResponse.json({ error: "JPEG, PNG or WebP only" }, { status: 415 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const { hash, verdict } = await moderateBytes(bytes);
    if (verdict === "b") return NextResponse.json({ error: "This image was rejected by moderation." }, { status: 422 });
    if (verdict !== "a") return NextResponse.json({ error: "Could not verify this image right now. Try again later." }, { status: 503 });

    if (!process.env.BLOB_READ_WRITE_TOKEN) return featureUnavailable("uploads", "BLOB_READ_WRITE_TOKEN is not set");
    try {
        const blob = await put(`shares/${hash}.${ext}`, bytes, {
            access: "public",
            contentType: file.type,
            addRandomSuffix: false,
            allowOverwrite: true,
        });
        return NextResponse.json({ url: blob.url });
    } catch (e) {
        console.error("Upload failed:", e);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
