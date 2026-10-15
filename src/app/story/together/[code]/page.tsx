import { TogetherBoard } from "@/components/together/TogetherBoard";

export default async function TogetherRoomPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    return <TogetherBoard code={code} />;
}
