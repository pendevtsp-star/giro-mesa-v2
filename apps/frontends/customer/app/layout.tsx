import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

const themeBootstrap = `try{const stored=localStorage.getItem("giromesa-customer-theme");const preference=stored==="light"||stored==="dark"||stored==="system"?stored:"system";const resolved=preference==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):preference;document.documentElement.dataset.themePreference=preference;document.documentElement.dataset.theme=resolved}catch{document.documentElement.dataset.themePreference="system";document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}`;

export const metadata: Metadata = {
  title: "Cardápio | GiroMesa",
  description: "Cardápio digital e atendimento na mesa.",
  referrer: "no-referrer",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#193c32" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        {children}
        <Script id="customer-theme" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
      </body>
    </html>
  );
}
