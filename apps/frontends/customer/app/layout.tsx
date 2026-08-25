import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

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
          {`document.documentElement.dataset.theme=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"`}
        </Script>
      </body>
    </html>
  );
}
