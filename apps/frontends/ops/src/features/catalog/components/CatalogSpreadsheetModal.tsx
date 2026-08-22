import { Button, DataTable, Icon, Label, Modal } from "@giromesa/ui";
import type { ChangeEvent } from "react";
import type { PilotCatalog } from "../../../operations.shared";
import { formatMoney } from "../../../rules";
import type { CatalogCsvRow } from "../catalog.csv";

type CatalogSpreadsheetModalProps = {
  busy: boolean;
  catalog: PilotCatalog;
  fileName: string;
  isOpen: boolean;
  preview: readonly CatalogCsvRow[];
  onClear: () => void;
  onClose: () => void;
  onCommit: () => Promise<void> | void;
  onDownloadTemplate: () => void;
  onExport: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function CatalogSpreadsheetModal({
  busy,
  catalog,
  fileName,
  isOpen,
  preview,
  onClear,
  onClose,
  onCommit,
  onDownloadTemplate,
  onExport,
  onUpload,
}: CatalogSpreadsheetModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Importar e Exportar Cardápio por Planilha"
      size="lg"
    >
      <div className="catalog-stack catalog-stack--16">
        <p className="catalog-muted-copy-085">
          Gerencie todo o seu catálogo em lote usando Excel ou Google Sheets. Baixe o modelo pronto
          ou exporte seu cardápio atual com 1 clique.
        </p>

        <div className="catalog-grid-2">
          <div className="catalog-sheet-card">
            <div>
              <strong className="catalog-label-block catalog-ink">Exportar Catálogo Atual</strong>
              <span className="catalog-muted-copy-tight">
                Gera um arquivo .CSV com todos os {catalog.products.length} produtos, categorias,
                preços e dados fiscais.
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onExport}
              className="catalog-sheet-action"
            >
              <Icon name="download" size={13} />
              <span>Baixar CSV do Cardápio</span>
            </Button>
          </div>

          <div className="catalog-sheet-card">
            <div>
              <strong className="catalog-label-block catalog-ink">Planilha Modelo em Branco</strong>
              <span className="catalog-muted-copy-tight">
                Baixe o template com colunas padronizadas e itens de exemplo para preencher no
                Excel.
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDownloadTemplate}
              className="catalog-sheet-action"
            >
              <Icon name="download" size={13} />
              <span>Baixar Modelo (.CSV)</span>
            </Button>
          </div>
        </div>

        <div className="catalog-sheet-upload">
          <Icon name="upload" size={28} />
          <strong className="catalog-label-block catalog-ink catalog-sheet-title">
            Carregar Planilha Preenchida (.CSV)
          </strong>
          <span className="catalog-muted-copy-tight">
            Selecione o arquivo exportado do Excel ou Google Sheets (separado por vírgulas ou
            ponto-e-vírgula).
          </span>

          <Label
            htmlFor="catalog-spreadsheet-file"
            className="gm-button gm-button--primary gm-button--sm catalog-sheet-file"
          >
            <Icon name="plus" size={13} />
            <span>{fileName ? `Arquivo: ${fileName}` : "Selecionar Arquivo CSV"}</span>
            <input
              id="catalog-spreadsheet-file"
              type="file"
              accept=".csv,text/csv"
              className="gm-sr-only"
              onChange={onUpload}
            />
          </Label>
        </div>

        {preview.length > 0 && (
          <div className="catalog-stack catalog-stack--8">
            <div className="catalog-between">
              <strong className="catalog-ink">
                Pré-visualização: {preview.length} produto(s) pronto(s) para importar
              </strong>
            </div>

            <div className="catalog-products-table-shell catalog-sheet-table-shell">
              <DataTable
                caption="Pré-visualização dos produtos do CSV"
                className="catalog-products-table"
              >
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Categoria</th>
                    <th>Preço Salão</th>
                    <th>Preço Delivery</th>
                    <th>NCM</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row) => (
                    <tr key={`${row.id ?? "novo"}-${row.name}-${row.categoryName}`}>
                      <td className="catalog-sheet-item">{row.name}</td>
                      <td>{row.categoryName}</td>
                      <td className="catalog-sheet-price">{formatMoney(row.priceCents)}</td>
                      <td>
                        {row.deliveryPriceCents == null ? "—" : formatMoney(row.deliveryPriceCents)}
                      </td>
                      <td className="catalog-sheet-ncm">{row.ncm}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>

            <div className="catalog-modal-actions">
              <Button variant="ghost" onClick={onClear}>
                Limpar
              </Button>
              <Button disabled={busy} variant="primary" onClick={() => void onCommit()}>
                Confirmar Importação de {preview.length} Itens
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
