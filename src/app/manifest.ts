import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Waifu100 & Story100",
        short_name: "Waifu100",
        start_url: "/",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#7c3aed",
        icons: [
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
    };
}
