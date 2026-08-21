import { Button, Icon, type IconName } from "@giromesa/ui";
import type { ChangeEvent } from "react";

export type CatalogLanguage = "pt" | "en" | "es";

type CatalogManagementHeaderProps = {
  categoryCount: number;
  comboCount: number;
  groupCount: number;
  language: CatalogLanguage;
  productCount: number;
  production: boolean;
  onExportCsv: () => void;
  onImportCsv: (event: ChangeEvent<HTMLInputElement>) => void;
  onLanguageChange: (language: CatalogLanguage) => void;
  onOpenBranding: () => void;
  onOpenBulkAdjustment: () => void;
  onOpenCustomerPreview: () => void;
  onOpenLabels: () => void;
  onOpenMatrix: () => void;
  onOpenModifiers: () => void;
  onOpenPdf: () => void;
  onOpenPromotions: () => void;
  onOpenQrGenerator: () => void;
  onOpenReorder: () => void;
  onOpenSpreadsheet: () => void;
};

type HeaderAction = {
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  title: string;
};

const LANGUAGE_OPTIONS: Array<{ label: string; title: string; value: CatalogLanguage }> = [
  { label: "🇧🇷 PT", title: "Cardápio em Português", value: "pt" },
  { label: "🇺🇸 EN", title: "English menu preview", value: "en" },
  { label: "🇪🇸 ES", title: "Menú en Español", value: "es" },
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
  categoryCount,
  comboCount,
  groupCount,
  language,
  productCount,
  onExportCsv,
  onImportCsv,
  onLanguageChange,
  onOpenBranding,
  onOpenBulkAdjustment,
  onOpenCustomerPreview,
  onOpenLabels,
  onOpenMatrix,
  onOpenModifiers,
  onOpenPdf,
  onOpenPromotions,
  onOpenQrGenerator,
  onOpenReorder,
  onOpenSpreadsheet,
}: CatalogManagementHeaderProps) {
  const headerActions: HeaderAction[] = [
    {
      icon: "finance",
      label: "Matriz BCG",
      onClick: onOpenMatrix,
      title: "Matriz de Engenharia de Cardápio (BCG)",
    },
    {
      icon: "salon",
      label: "Ver como Cliente & QR",
      onClick: onOpenCustomerPreview,
      title: "Simular Cardápio do Cliente e gerar QR Codes",
    },
    {
      icon: "catalog",
      label: "Etiquetas / Tags",
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
      icon: "list",
      label: `Opcionais & Modificadores (${groupCount})`,
      onClick: onOpenModifiers,
      title: "Gerenciar grupos de complementos, adicionais e ponto da carne",
    },
    {
      icon: "finance",
      label: `Combos & Promoções (${comboCount})`,
      onClick: onOpenPromotions,
      title: "Gerenciar combos especiais e promoções de Happy Hour",
    },
  ];

  const actions = headerActions;

  const secondaryActions: HeaderAction[] = [
    {
      icon: "upload",
      label: "Planilha CSV",
      onClick: onOpenSpreadsheet,
      title: "Importar e exportar cardápio em massa via planilha CSV / Excel",
    },
    {
      icon: "settings",
      label: "Identidade & Branding",
      onClick: onOpenBranding,
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
        <h2>Gerenciar Cardápio</h2>
        <p>
          {productCount} itens cadastrados em {categoryCount} categorias
        </p>
      </div>

      <fieldset className="gm-toolbar gm-toolbar--scroll catalog-management-header__actions">
        <legend className="catalog-visually-hidden">Ações do cardápio</legend>
        {actions.map((action) => (
          <HeaderActionButton key={action.label} {...action} />
        ))}

        <label
          className="gm-button gm-button--secondary gm-button--sm catalog-management-header__import"
          title="Importar Cardápio atualizado via CSV"
        >
          <Icon name="upload" size={14} />
          <span>Importar CSV</span>
          <input
            accept=".csv"
            className="catalog-visually-hidden"
            onChange={onImportCsv}
            type="file"
          />
        </label>

        <fieldset className="catalog-language-switcher">
          <legend className="catalog-visually-hidden">Idioma do cardápio</legend>
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

        <Button
          className="catalog-management-header__action catalog-management-header__action--accent"
          onClick={onOpenQrGenerator}
          size="sm"
          title="Gerar e imprimir placas de QR Code numeradas para mesas e balcões"
          variant="secondary"
        >
          <Icon name="catalog" size={14} />
          <span>Placas QR de Mesas</span>
        </Button>

        {secondaryActions.map((action) => (
          <HeaderActionButton key={action.label} {...action} />
        ))}
      </fieldset>
    </header>
  );
}
