"use client";

import Link from "next/link";
import { cardHtml, CardDefs, CardHtml } from "./card";
import type { CardDto } from "./api";
import type { TierName } from "./pixel";

/** The opened share: the same card the player pulled, plus a way into today's game. */
export function CardShareStage({
    card,
    tier,
    dayKey,
    guesses,
    total,
    dayNumber,
}: {
    card: CardDto;
    tier: TierName;
    dayKey: string;
    guesses: number;
    total: number;
    dayNumber: number;
}) {
    return (
        <div className="gg">
            <CardDefs />
            <main className="g-cardshare">
                <CardHtml html={cardHtml(card, tier, { day: dayKey, guesses, total })} />
                <p className="g-lead">waifu100 Daily #{dayNumber}</p>
                <Link className="g-btn red big" href="/daily">มาเล่น</Link>
            </main>
        </div>
    );
}
