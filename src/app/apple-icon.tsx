import { renderAppIcon } from "@/lib/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** <link rel="apple-touch-icon"> (iOS draws its own rounded mask, so no corners). */
export default function AppleIcon() {
    return renderAppIcon(180, false);
}
