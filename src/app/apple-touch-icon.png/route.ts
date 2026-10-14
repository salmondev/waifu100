import { renderAppIcon } from "@/lib/app-icon";

/** iOS probes this fixed path even without a <link>; it used to 404 (T-0010). */
export const dynamic = "force-static";

export function GET() {
    return renderAppIcon(180, false);
}
