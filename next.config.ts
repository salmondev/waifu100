import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // T-0009 A: the Next optimizer must not be an unmoderated open proxy.
    // All remote images go through /api/img (moderated) instead.
    remotePatterns: [],
  },
  // Baseline security headers (no CSP yet: see security audit notes).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
