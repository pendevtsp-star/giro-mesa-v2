import Link from "next/link";
import { CookiePreferences } from "./cookie-preferences";
import { Logo } from "./header";

const groups = [
  {
    title: "Produto",
    links: [
      ["Visão geral", "/#produto"],
      ["Planos", "/#planos"],
      ["Teste assistido", "/teste-gratis"],
      ["Instalar GiroMesa", "/instalar"],
    ],
  },
  {
    title: "Soluções",
    links: [
      ["Restaurantes", "/#solucoes"],
      ["Bares", "/#solucoes"],
      ["Cafeterias", "/#solucoes"],
    ],
  },
  {
    title: "Recursos",
    links: [
      ["Central de ajuda", "/suporte"],
      ["Segurança da conta", "/seguranca"],
      ["Contato", "/contato"],
      ["Status", "/suporte#status"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Termos de uso", "/termos"],
      ["Privacidade", "/privacidade"],
      ["Cookies", "/privacidade#cookies"],
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo />
          <p>Operação conectada, decisões mais claras.</p>
          <p className="footer-note">
            Produto em desenvolvimento. Integrações dependem de contratação e homologação.
          </p>
        </div>
        {groups.map((group) => (
          <div key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href}>{label}</Link>
                </li>
              ))}
              {group.title === "Legal" ? (
                <li>
                  <CookiePreferences />
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} GiroMesa</span>
        <span>Feito para operações brasileiras de food service.</span>
      </div>
    </footer>
  );
}
