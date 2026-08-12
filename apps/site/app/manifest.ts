import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GiroMesa",
    short_name: "GiroMesa",
    description: "Gestão conectada para operações de food service.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffdf7",
    theme_color: "#163f35",
    icons: [
      { src: "/icons/pwa-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icons/pwa-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
