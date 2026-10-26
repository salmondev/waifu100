import { renderAppIcon } from "@/lib/app-icon";

export const dynamic = "force-static";

export function GET() {
    return renderAppIcon(512);
}
