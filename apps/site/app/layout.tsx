import { Icon } from "@giromesa/ui";
import type { Metadata } from "next";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { PwaClient } from "../components/pwa-client";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GiroMesa | Gestão para food service", template: "%s | GiroMesa" },
  description: "Salão, balcão, produção, estoque e gestão conectados em uma só operação.",
  icons: {
    icon: [
      { url: "/icons/pwa-192.svg", type: "image/svg+xml", sizes: "192x192" },
      { url: "/icons/pwa-512.svg", type: "image/svg+xml", sizes: "512x512" },
    ],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=Ol%C3%A1%2C%20quero%20conhecer%20o%20GiroMesa`
    : "/contato";

  return (
    <html lang="pt-BR">
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        <Header />
        {children}
        <Footer />
        <PwaClient />
        <a
          className="whatsapp"
          href={whatsappHref}
          target={whatsappNumber ? "_blank" : undefined}
          rel={whatsappNumber ? "noreferrer" : undefined}
          aria-label={
            whatsappNumber
              ? "Falar com o comercial no WhatsApp (abre em nova aba)"
              : "Abrir página de contato"
          }
        >
          <Icon name={whatsappNumber ? "sparkles" : "mail"} />
          <b className="whatsapp-label">{whatsappNumber ? "WhatsApp" : "Contato"}</b>
        </a>
      </body>
    </html>
  );
}
