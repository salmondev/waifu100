import { OG_ALT, OG_SIZE, renderDailyOg } from "./_og/card";

// Static link-preview image for /daily (T-0025); built once at build time. Same picture for og:image and twitter:image.
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
    return renderDailyOg();
}
