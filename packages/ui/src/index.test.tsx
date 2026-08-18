import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Badge,
  Button,
  DataTable,
  Modal,
  Progress,
  SearchField,
  SegmentedTabs,
  Toast,
  Tooltip,
} from "./index";

describe("componentes compartilhados", () => {
  it("mantém semântica nativa e estado acessível", () => {
    const html = renderToStaticMarkup(
      <div>
        <Button disabled>Salvar</Button>
        <Badge tone="success">Sincronizado</Badge>
        <Progress label="Implantação" value={140} />
        <DataTable caption="Resumo">
          <tbody>
            <tr>
              <td>Valor</td>
            </tr>
          </tbody>
        </DataTable>
        <Tooltip content="Ajuda contextual">
          <button type="button">?</button>
        </Tooltip>
        <SearchField placeholder="Buscar mesas" />
        <SegmentedTabs
          active="all"
          items={[
            { id: "all", label: "Todas", count: 4 },
            { id: "open", label: "Abertas", count: 2 },
          ]}
          label="Filtrar mesas"
          onChange={() => undefined}
        />
        <Modal isOpen onClose={() => undefined} title="Editar mesa">
          Conteúdo
        </Modal>
        <Toast message="Mesa criada" onDismiss={() => undefined} title="Salão atualizado" />
      </div>,
    );

    expect(html).toContain("<button");
    expect(html).toContain("disabled");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("<caption");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain('aria-label="Buscar mesas"');
    expect(html).toContain("Filtrar mesas");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain("Salão atualizado");
    expect(html).toContain('aria-label="Fechar aviso"');
  });
});
