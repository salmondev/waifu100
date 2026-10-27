import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { GachaApp } from "@/components/gacha/gacha-app";
import "./gacha.css";

const TITLE = "Gacha Guess รายวัน | WAIFU100";
const DESCRIPTION = "ทายตัวละครอนิเมะวันละตัว ดูคำใบ้ เปิดซอง สะสมการ์ด 4 ระดับ";

// Link previews (T-0025): absolute og:image / twitter:image URLs via metadataBase (no env), large card on X,
// theme-color for the Discord embed bar. The images come from opengraph-image.tsx / twitter-image.tsx.
export const metadata: Metadata = {
    metadataBase: new URL("https://waifu100.vercel.app"),
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/daily" },
    openGraph: { type: "website", url: "/daily", siteName: "WAIFU100", locale: "th_TH", title: TITLE, description: DESCRIPTION },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#29adff" };

export default function DailyPage() {
    return (
        <Suspense fallback={null}>
            <GachaApp />
        </Suspense>
    );
}
