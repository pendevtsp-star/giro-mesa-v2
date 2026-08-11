import type { Metadata, Viewport } from "next";
import { PwaClient } from "../components/pwa-client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cardápio | GiroMesa",
  description: "Cardápio digital e atendimento na mesa.",
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
