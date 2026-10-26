import type { Metadata } from "next";
import { Suspense } from "react";
import { GachaApp } from "@/components/gacha/gacha-app";
import "./gacha.css";

export const metadata: Metadata = {
    title: "Gacha Guess รายวัน | WAIFU100",
    description: "เดาตัวละครอนิเมะวันละตัว เปิดซองรับการ์ด เก็บเข้าอัลบั้ม",
};

export default function DailyPage() {
    return (
        <Suspense fallback={null}>
            <GachaApp />
        </Suspense>
    );
}
