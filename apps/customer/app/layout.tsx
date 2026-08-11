import type { Metadata, Viewport } from "next";
import { PwaClient } from "../components/pwa-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cardápio | GiroMesa",
  description: "Cardápio digital e atendimento na mesa.",
  icons: {
    icon: [
      { url: "/icons/pwa-192.svg", type: "image/svg+xml", sizes: "192x192" },
      { url: "/icons/pwa-512.svg", type: "image/svg+xml", sizes: "512x512" },
    ],
  },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#193c32" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <PwaClient />
      </body>
    </html>
  );
}
