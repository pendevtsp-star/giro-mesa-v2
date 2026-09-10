import { Button, Icon, type IconName } from "@giromesa/ui";
import type { ChangeEvent } from "react";

export type CatalogLanguage = "pt" | "en" | "es";

type CatalogManagementHeaderProps = {
  categoryCount: number;
  comboCount: number;
  groupCount: number;
  language: CatalogLanguage;
  productCount: number;
  availableProductCount: number;
  production: boolean;
  onExportCsv: () => void;
  onImportCsv: (event: ChangeEvent<HTMLInputElement>) => void;
  onLanguageChange: (language: CatalogLanguage) => void;
  brandingHref: string;
  onOpenBulkAdjustment: () => void;
  onOpenNewProduct: () => void;
  onOpenCustomerPreview: () => void;
  onOpenLabels: () => void;
  onOpenMatrix: () => void;
  onOpenModifiers: () => void;
  onOpenPdf: () => void;
  onOpenPromotions: () => void;
  onOpenReorder: () => void;
  onOpenSpreadsheet: () => void;
  tableQrHref: string;
};

type HeaderAction = {
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  title: string;
};

type HeaderLink = Omit<HeaderAction, "onClick"> & { href: string };

const LANGUAGE_OPTIONS: Array<{ label: string; title: string; value: CatalogLanguage }> = [
  { label: "🇧🇷 PT", title: "Cardápio em Português", value: "pt" },
  { label: "🇺🇸 EN", title: "Cardápio em inglês", value: "en" },
  { label: "🇪🇸 ES", title: "Cardápio em espanhol", value: "es" },
];

function HeaderActionButton({ disabled, icon, label, onClick, title }: HeaderAction) {
  return (
    <Button
      className="catalog-management-header__action"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      title={disabled ? "Aguardando integração persistente para produção" : title}
      variant="secondary"
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </Button>
  );
}

export function CatalogManagementHeader({
  brandingHref,
  categoryCount,
  comboCount,
  groupCount,
  language,
  productCount,
  availableProductCount,
  onExportCsv,
  onImportCsv,
  onLanguageChange,
  onOpenBulkAdjustment,
  onOpenNewProduct,
  onOpenCustomerPreview,
  onOpenLabels,
  onOpenMatrix,
  onOpenModifiers,
  onOpenPdf,
  onOpenPromotions,
  onOpenReorder,
  onOpenSpreadsheet,
  production,
  tableQrHref,
}: CatalogManagementHeaderProps) {
  const headerActions: HeaderAction[] = [
    {
      icon: "salon",
      label: "Conferir como cliente",
      onClick: onOpenCustomerPreview,
      title: "Abrir a versão do cardápio que o cliente verá",
    },
    {
      icon: "list",
      label: `Adicionais e opções (${groupCount})`,
      onClick: onOpenModifiers,
      title: "Gerenciar grupos de complementos, adicionais e ponto da carne",
    },
    {
      icon: "finance",
      label: `Combos e promoções (${comboCount})`,
      onClick: onOpenPromotions,
      title: "Gerenciar combos especiais e promoções de Happy Hour",
    },
  ];

  const actions = headerActions;

  const secondaryActions: Array<HeaderAction | HeaderLink> = [
    {
      icon: "finance",
      label: "Desempenho dos produtos",
      onClick: onOpenMatrix,
      title: "Matriz de Engenharia de Cardápio (BCG)",
    },
    {
      icon: "catalog",
      label: "Etiquetas",
      onClick: onOpenLabels,
      title: "Gerar etiquetas de vitrine e placas de mesa",
    },
    {
      icon: "download",
      label: "Exportar CSV",
      onClick: onExportCsv,
      title: "Exportar Cardápio em CSV para Excel",
    },
    {
      icon: "upload",
      label: "Planilha CSV",
      onClick: onOpenSpreadsheet,
      title: "Importar e exportar cardápio em massa via planilha CSV / Excel",
    },
    {
      icon: "settings",
      label: "Identidade visual",
      href: brandingHref,
      title: "Personalizar nome, cores, slogan e avisos do estabelecimento",
    },
    {
      icon: "download",
      label: "Gerar PDF / Imprimir",
      onClick: onOpenPdf,
      title: "Gerar Cardápio em PDF e imprimir",
    },
    {
      icon: "list",
      label: "Reordenar Categorias",
      onClick: onOpenReorder,
      title: "Reorganizar a ordem das categorias no cardápio",
    },
    {
      icon: "finance",
      label: "Reajuste em Lote",
      onClick: onOpenBulkAdjustment,
      title: "Aplicar reajuste de preços em lote",
    },
  ];

  return (
    <header className="catalog-management-header">
      <div className="catalog-management-header__summary">
        <h2>Cardápio da operação</h2>
        <p>
          <strong>{availableProductCount} disponíveis</strong> ·{" "}
          {productCount - availableProductCount} pausados · {categoryCount} categorias
        </p>
      </div>

      <fieldset className="gm-toolbar gm-toolbar--scroll catalog-management-header__actions">
        <legend className="gm-sr-only">Ações do cardápio</legend>
        <Button
          className="catalog-management-header__action"
          disabled={!production}
          onClick={onOpenNewProduct}
          size="sm"
          title={
            production
              ? "Cadastrar um item no cardápio"
              : "Crie uma categoria e uma estação primeiro"
          }
        >
          <Icon name="plus" size={14} />
          <span>Novo produto</span>
        </Button>
        {actions.map((action) => (
          <HeaderActionButton key={action.label} {...action} />
        ))}

        <details className="catalog-management-header__more">
          <summary>
            <Icon name="settings" size={14} />
            <span>Mais ações</span>
            <small>{secondaryActions.length + 2}</small>
          </summary>
          <div className="gm-toolbar catalog-management-header__more-actions">
            <label
              className="gm-button gm-button--secondary gm-button--sm catalog-management-header__import"
              title="Importar Cardápio atualizado via CSV"
            >
              <Icon name="upload" size={14} />
              <span>Importar CSV</span>
              <input accept=".csv" className="gm-sr-only" onChange={onImportCsv} type="file" />
            </label>

            <fieldset className="catalog-language-switcher">
              <legend className="gm-sr-only">Idioma do cardápio</legend>
              <span className="catalog-language-switcher__label">Idioma:</span>
              {LANGUAGE_OPTIONS.map((option) => (
                <Button
                  aria-pressed={language === option.value}
                  className="catalog-language-switcher__option"
                  data-active={language === option.value}
                  key={option.value}
                  onClick={() => onLanguageChange(option.value)}
                  title={option.title}
                  type="button"
                >
                  {option.label}
                </Button>
              ))}
            </fieldset>

            <a
              className="gm-button gm-button--secondary gm-button--sm catalog-management-header__action catalog-management-header__action--accent"
              href={tableQrHref}
              title="Gerar e imprimir placas de QR Code numeradas para mesas e balcões"
            >
              <Icon name="catalog" size={14} />
              <span>Abrir QR das mesas</span>
            </a>

            {secondaryActions.map((action) =>
              "href" in action ? (
                <a
                  className="gm-button gm-button--secondary gm-button--sm catalog-management-header__action"
                  href={action.href}
                  key={action.label}
                  title={action.title}
                >
                  <Icon name={action.icon} size={14} />
                  <span>{action.label}</span>
                </a>
              ) : (
                <HeaderActionButton key={action.label} {...action} />
              ),
            )}
          </div>
        </details>
      </fieldset>
    </header>
  );
}
