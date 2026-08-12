import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cardápio GiroMesa",
    short_name: "GiroMesa",
    description: "Cardápio digital e atendimento na mesa.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffdf8",
    theme_color: "#193c32",
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
