import { friendlyError } from "@/lib/public-errors";
/**
 * Client side of /api/upload (T-0009 review M1): the bytes go to our server,
 * which moderates them before storing. Throws on any refusal; callers already
 * drop the image when an upload fails.
 */
export const CLIENT_UPLOAD_MAX = 4 * 1024 * 1024;

async function shrink(blob: Blob): Promise<Blob> {
    if (blob.size <= CLIENT_UPLOAD_MAX && /^image\/(jpeg|png|webp)$/.test(blob.type)) return blob;
    const bitmap = await createImageBitmap(blob);
    let scale = 1;
    for (let attempt = 0; attempt < 4; attempt++) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
        if (out && out.size <= CLIENT_UPLOAD_MAX) return out;
        scale *= 0.7;
    }
    throw new Error("Image too large to upload");
}

export async function uploadModeratedImage(blob: Blob, fetchImpl: typeof fetch = fetch): Promise<string> {
    const body = new FormData();
    body.append("file", await shrink(blob));
    const res = await fetchImpl("/api/upload", { method: "POST", body });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) throw new Error(friendlyError(data.error, "Upload failed. Please try again."));
    return data.url;
}
