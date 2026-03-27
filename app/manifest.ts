import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "paysats",
    short_name: "paysats",
    start_url: "/connect",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    description: "QRIS settlement from Lightning through Base rails",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
