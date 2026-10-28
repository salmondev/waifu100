import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardShareStage } from "@/components/gacha/card-share-stage";
import { cardShareUrl } from "@/lib/gacha-card-share";
import { loadCardShare } from "@/server/gacha/service";
import "../../daily/gacha.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PageProps {
    params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { code } = await params;
    const view = await loadCardShare(code);
    if (!view) return { title: "ไม่พบการ์ด | WAIFU100" };
    return {
        metadataBase: new URL("https://waifu100.vercel.app"),
        title: `${view.title} | WAIFU100`,
        description: view.description,
        alternates: { canonical: cardShareUrl(code) },
        openGraph: {
            type: "website",
            url: cardShareUrl(code),
            siteName: "WAIFU100",
            locale: "th_TH",
            title: view.title,
            description: view.description,
        },
        twitter: { card: "summary_large_image", title: view.title, description: view.description },
    };
}

export default async function CardSharePage({ params }: PageProps) {
    const { code } = await params;
    const view = await loadCardShare(code);
    if (!view) notFound();
    return (
        <CardShareStage
            card={view.card}
            tier={view.tier}
            dayKey={view.dayKey}
            guesses={view.guesses}
            total={view.total}
            dayNumber={view.dayNumber}
        />
    );
}
