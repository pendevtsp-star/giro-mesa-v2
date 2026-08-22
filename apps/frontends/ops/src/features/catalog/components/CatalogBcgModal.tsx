import { Button, Icon, Modal } from "@giromesa/ui";
import type { CatalogBcgProduct } from "../../../api";
import type { CatalogProduct } from "../../../operations.shared";
import { formatMoney } from "../../../rules";

type CatalogBcgModalProps = {
  open: boolean;
  onClose: () => void;
  products: readonly CatalogProduct[];
  bcgProducts: readonly CatalogBcgProduct[];
};

const QUADRANTS = [
  {
    quadrant: "star",
    tone: "success",
    icon: "check",
    title: "Estrelas (Stars)",
    badge: "Alta Margem + Alta Venda",
    strategy:
      "Estratégia: Manter consistência, posicionar no topo do cardápio e não alterar receitas.",
  },
  {
    quadrant: "opportunity",
    tone: "info",
    icon: "catalog",
    title: "Quebra-Cabeças (Puzzles)",
    badge: "Alta Margem + Baixa Venda",
    strategy:
      "Estratégia: Adicionar fotos atraentes, treinar garçons para venda sugerida e destacar como sugestão do chef.",
  },
  {
    quadrant: "volume",
    tone: "warning",
    icon: "clock",
    title: "Burros de Carga (Plowhorses)",
    badge: "Baixa Margem + Alta Venda",
    strategy:
      "Estratégia: Reajustar ligeiramente o preço (+5%), renegociar insumos com fornecedores ou ajustar porções.",
  },
  {
    quadrant: "dog",
    tone: "danger",
    icon: "alerts",
    title: "Cães (Dogs)",
    badge: "Baixa Margem + Baixa Venda",
    strategy:
      "Estratégia: Avaliar remoção do cardápio ou reformular completamente o prato para reduzir desperdício de insumos.",
  },
] as const satisfies ReadonlyArray<{
  quadrant: CatalogBcgProduct["quadrant"];
  tone: "success" | "info" | "warning" | "danger";
  icon: "check" | "catalog" | "clock" | "alerts";
  title: string;
  badge: string;
  strategy: string;
}>;

export function CatalogBcgModal({ open, onClose, products, bcgProducts }: CatalogBcgModalProps) {
  const bcgByProductId = new Map(
    bcgProducts.map((product) => [product.productId, product] as const),
  );

  return (
    <Modal
      isOpen={open}
      title="Matriz de Engenharia de Cardápio (Menu Engineering Matrix)"
      onClose={onClose}
    >
      <div className="catalog-bcg-modal">
        <p className="catalog-muted-copy-085">
          Classificação estratégica dos pratos baseada no cruzamento de{" "}
          <strong>Margem de Lucro</strong> e <strong>Popularidade de Vendas</strong>.
        </p>

        <div className="catalog-bcg-grid">
          {QUADRANTS.map(({ quadrant, tone, icon, title, badge, strategy }) => {
            const headingId = `catalog-bcg-${quadrant}-title`;
            const quadrantProducts = products.filter(
              (product) => bcgByProductId.get(product.id)?.quadrant === quadrant,
            );

            return (
              <section
                key={quadrant}
                aria-labelledby={headingId}
                className="catalog-bcg-quadrant"
                data-tone={tone}
              >
                <div className="catalog-between catalog-between--mb8">
                  <h3 id={headingId} className="catalog-bcg-quadrant__title">
                    <Icon name={icon} size={16} /> {title}
                  </h3>
                  <span className="catalog-bcg-quadrant__badge">{badge}</span>
                </div>
                <p className="catalog-muted-copy-tight">{strategy}</p>
                <ul className="catalog-stack catalog-stack--6 m-0 list-none p-0">
                  {quadrantProducts.map((product) => (
                    <li key={product.id} className="catalog-summary-row">
                      <span>{product.name}</span>
                      <strong>{formatMoney(product.priceCents)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="catalog-actions-end">
          <Button variant="primary" onClick={onClose}>
            Fechar Análise
          </Button>
        </div>
      </div>
    </Modal>
  );
}
