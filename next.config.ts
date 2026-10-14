import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // T-0009 A: the Next optimizer must not be an unmoderated open proxy.
    // All remote images go through /api/img (moderated) instead.
    remotePatterns: [],
  },
};

export default nextConfig;
