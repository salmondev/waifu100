"use client";

import { proxied } from "@/lib/img-proxy";
import { DEFAULT_TITLE_STYLE, STORY_BRAND, storyColumns, type TitleStyle } from "@/lib/story/config";
import type { StoryItem } from "@/lib/share-schema";

/**
 * Story grid -> PNG in the browser (item 2). Covers are drawn from the
 * same-origin moderated proxy, so the canvas is never CORS-tainted and the
 * export shows exactly what passed moderation.
 */
export const EXPORT_CELL_W = 200;
export const EXPORT_CELL_H = 300;

/** Extra caption band per row when titles go below the image (T-0010). */
export const EXPORT_CAPTION_H = 44;

export function exportLayout(size: number, titleStyle: TitleStyle = DEFAULT_TITLE_STYLE, layoutCols?: number | null) {
    const cols = storyColumns(size, layoutCols);
    const rows = Math.ceil(size / cols);
    const pad = 24;
    const header = 72;
    const footer = 40;
    const caption = titleStyle === "below" ? EXPORT_CAPTION_H : 0;
    const rowH = EXPORT_CELL_H + caption;
    return { cols, rows, pad, header, footer, caption, rowH, width: pad * 2 + cols * EXPORT_CELL_W, height: header + rows * rowH + footer + pad };
}

/** Up to `maxLines` lines that fit `width`, the last one ellipsised. Exported for tests. */
export function wrapTitle(measure: (s: string) => number, text: string, width: number, maxLines = 2): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (let i = 0; i < words.length; i++) {
        const tryLine = line ? `${line} ${words[i]}` : words[i];
        if (measure(tryLine) <= width || !line) {
            line = tryLine;
            continue;
        }
        lines.push(line);
        line = words[i];
        if (lines.length === maxLines - 1) {
            line = words.slice(i).join(" ");
            break;
        }
    }
    if (line) lines.push(line);
    const out = lines.slice(0, maxLines);
    const last = out.length - 1;
    if (last >= 0 && measure(out[last]) > width) {
        let t = out[last];
        while (t.length > 1 && measure(`${t}…`) > width) t = t.slice(0, -1);
        out[last] = `${t.trimEnd()}…`;
    }
    return out;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        const t = setTimeout(() => resolve(null), 15000);
        img.onload = () => (clearTimeout(t), resolve(img));
        img.onerror = () => (clearTimeout(t), resolve(null));
        img.src = src;
    });
}

export async function exportStoryPng(title: string, items: (StoryItem | null)[], titleStyle: TitleStyle = DEFAULT_TITLE_STYLE, cols?: number | null): Promise<Blob | null> {
    const L = exportLayout(items.length, titleStyle, cols);
    const canvas = document.createElement("canvas");
    canvas.width = L.width;
    canvas.height = L.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, L.width, L.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px Sarabun, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText((title || `${STORY_BRAND} Grid`).slice(0, 60), L.width / 2, 48);

    const imgs = await Promise.all(items.map((it) => (it ? loadImage(proxied(it.cover, 256)) : Promise.resolve(null))));
    items.forEach((it, i) => {
        const x = L.pad + (i % L.cols) * EXPORT_CELL_W;
        const y = L.header + Math.floor(i / L.cols) * L.rowH;
        ctx.fillStyle = "#18181b";
        ctx.fillRect(x + 2, y + 2, EXPORT_CELL_W - 4, EXPORT_CELL_H - 4);
        const img = imgs[i];
        if (img && img.naturalWidth) {
            const bw = EXPORT_CELL_W - 4;
            const bh = EXPORT_CELL_H - 4;
            const cx = x + EXPORT_CELL_W / 2;
            const cy = y + EXPORT_CELL_H / 2;
            const draw = (scale: number) => {
                const w = img.naturalWidth * scale;
                const h = img.naturalHeight * scale;
                ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
            };
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 2, y + 2, bw, bh);
            ctx.clip();
            // Backdrop: the same image, overflowing and blurred, so the cell is
            // full-bleed without the picture itself losing anything. Mirrors
            // FittedImage on screen. Browsers without ctx.filter simply get a
            // sharp zoomed backdrop, which still reads correctly.
            ctx.filter = "blur(18px)";
            ctx.globalAlpha = 0.45;
            draw(Math.max(bw / img.naturalWidth, bh / img.naturalHeight) * 1.12);
            ctx.filter = "none";
            ctx.globalAlpha = 1;
            // The picture itself: contained, so nothing is cropped.
            draw(Math.min(bw / img.naturalWidth, bh / img.naturalHeight));
            ctx.restore();
        }
        const name = it?.title?.trim();
        const overlay = titleStyle === "overlay" && !!name;
        if (overlay) {
            const g = ctx.createLinearGradient(0, y + EXPORT_CELL_H - 110, 0, y + EXPORT_CELL_H - 2);
            g.addColorStop(0, "rgba(0,0,0,0)");
            g.addColorStop(0.55, "rgba(0,0,0,0.6)");
            g.addColorStop(1, "rgba(0,0,0,0.95)");
            ctx.fillStyle = g;
            ctx.fillRect(x + 2, y + EXPORT_CELL_H - 110, EXPORT_CELL_W - 4, 108);
        }
        if (name && titleStyle !== "hidden") {
            ctx.font = `${overlay ? "bold " : ""}15px Sarabun, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillStyle = overlay ? "#ffffff" : "#d4d4d8";
            const lines = wrapTitle((t) => ctx.measureText(t).width, name, EXPORT_CELL_W - 16);
            const lh = 18;
            const top = overlay ? y + EXPORT_CELL_H - 10 - lh * (lines.length - 1) : y + EXPORT_CELL_H + 18;
            lines.forEach((ln, k) => ctx.fillText(ln, x + EXPORT_CELL_W / 2, top + k * lh));
        }
        // rank badge: top-left when the title sits on the image, else bottom-left
        const by = overlay ? y + 2 : y + EXPORT_CELL_H - 28;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(x + 2, by, 30, 26);
        ctx.fillStyle = "#e4e4e7";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), x + 17, by + 19);
    });
    ctx.fillStyle = "#71717a";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "center";
    // Shared image: brand only, no data-source credit (2026-10-15). Credits stay on the site.
    ctx.fillText(STORY_BRAND, L.width / 2, L.height - L.pad);

    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
