import type { Metadata } from "next";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GiroMesa | Gestão para food service", template: "%s | GiroMesa" },
  description: "Salão, balcão, produção, estoque e gestão conectados em uma só operação.",
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
          <span aria-hidden="true">◉</span>
          <b className="whatsapp-label">{whatsappNumber ? "WhatsApp" : "Contato"}</b>
        </a>
      </body>
    </html>
  );
}
