"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openTogetherRoom } from "@/components/together/TogetherBoard";

/** Opens a new empty story room on the together server, then joins it. */
export default function TogetherStartPage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        openTogetherRoom("story")
            .then((code) => router.replace(`/story/together/${code}`))
            .catch(() => setError("The together room isn't running on this machine yet."));
    }, [router]);

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-300 grid place-items-center px-6 text-center">
            <p>{error ?? "Opening build grid together…"}</p>
        </div>
    );
}
