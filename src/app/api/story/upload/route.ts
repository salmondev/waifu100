import { NextRequest, NextResponse } from "next/server";
import { featureUnavailable } from "@/lib/public-errors";
import { put } from "@vercel/blob";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { moderateBytes } from "@/server/moderation/moderator";
import { STORY_TITLE_MAX } from "@/lib/story/config";
import { webItemId } from "@/server/story-web-search";
import { toMediaType } from "@/lib/share-schema";
import { TEXT_REJECTED } from "@/lib/text-policy";
import { screenUserTexts } from "@/server/text-screen";

export const runtime = "nodejs";

export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Story custom cover (T-0009 D). The file must pass moderation BEFORE it is
 * stored; the exact checked bytes are stored (named by their sha256), so the
 * display proxy hits the same verdict. Fails closed without Gemini or Blob.
 */
export async function POST(req: NextRequest) {
    const limited = await enforceRateLimit(req, LIMITS.storyUpload);
    if (limited) return limited;

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const title = String(form?.get("title") ?? "").trim().slice(0, STORY_TITLE_MAX) || "Custom cover";
    const type = toMediaType(form?.get("type"));
    if (!(file instanceof Blob)) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: "Max 2 MB" }, { status: 413 });
    const ext = TYPES[file.type];
    if (!ext) return NextResponse.json({ error: "JPEG, PNG or WebP only" }, { status: 415 });

    if (!(await screenUserTexts([title]))) return NextResponse.json({ error: TEXT_REJECTED }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const { hash, verdict } = await moderateBytes(bytes);
    if (verdict === "b") return NextResponse.json({ error: "This image was rejected by moderation." }, { status: 422 });
    if (verdict !== "a") return NextResponse.json({ error: "Could not verify this image right now. Try again later." }, { status: 503 });

    if (!process.env.BLOB_READ_WRITE_TOKEN) return featureUnavailable("uploads", "BLOB_READ_WRITE_TOKEN is not set");
    try {
        const blob = await put(`story/${hash}.${ext}`, bytes, {
            access: "public",
            contentType: file.type,
            addRandomSuffix: false,
            allowOverwrite: true,
        });
        return NextResponse.json({ item: { id: webItemId(blob.url), type, title, cover: blob.url, src: "upload" } });
    } catch (e) {
        console.error("Story upload failed:", e);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
