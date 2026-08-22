import Link from "next/link";

export function Logo() {
  return (
    <Link className="logo" href="/" aria-label="GiroMesa, página inicial">
      <span className="logo-mark" aria-hidden="true">
        G
      </span>
      <span>GiroMesa</span>
    </Link>
  );
}

export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Navegação principal">
          <a href="/#produto">Produto</a>
          <a href="/#solucoes">Soluções</a>
          <a href="/#planos">Planos</a>
          <a href="/#recursos">Recursos</a>
          <Link href="/instalar">Instalar</Link>
        </nav>
        <div className="header-actions">
          <Link className="button button-ghost" href="/login">
            Entrar
          </Link>
          <Link className="button button-primary header-trial" href="/teste-gratis">
            Testar 14 dias
          </Link>
        </div>
      </div>
    </header>
  );
}
