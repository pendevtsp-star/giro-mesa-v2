import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DataTable,
  Input,
  Label,
  Modal,
  NativeSelect,
  Progress,
  SearchField,
  SegmentedTabs,
  Separator,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Toast,
  Tooltip,
} from "./index";

describe("componentes compartilhados", () => {
  it("mantém semântica nativa e estado acessível", () => {
    const html = renderToStaticMarkup(
      <div>
        <Button disabled>Salvar</Button>
        <Badge tone="success">Sincronizado</Badge>
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" />
        <Textarea aria-label="Observação" />
        <NativeSelect aria-label="Unidade">
          <option>Centro</option>
        </NativeSelect>
        <Separator />
        <Checkbox aria-label="Selecionar item" defaultChecked />
        <Switch aria-label="Loja aberta" checked />
        <Alert>
          <AlertTitle>Atenção</AlertTitle>
          <AlertDescription>Revise o caixa.</AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
          </CardHeader>
          <CardContent>Conteúdo</CardContent>
        </Card>
        <Accordion>
          <AccordionItem open>
            <AccordionTrigger>Detalhes</AccordionTrigger>
            <AccordionContent>Conteúdo</AccordionContent>
          </AccordionItem>
        </Accordion>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Mesa 1</TableCell>
            </TableRow>
          </TableBody>
        </Table>
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
        <Modal
          contentClassName="custom-modal-content"
          isOpen
          onClose={() => undefined}
          title="Editar mesa"
        >
          Conteúdo
        </Modal>
        <Toast message="Mesa criada" onDismiss={() => undefined} title="Salão atualizado" />
      </div>,
    );

    expect(html).toContain("<button");
    expect(html).toContain("disabled");
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('data-slot="input"');
    expect(html).toContain('data-slot="textarea"');
    expect(html).toContain('data-slot="native-select"');
    expect(html).toContain('data-slot="separator"');
    expect(html).toContain('data-slot="checkbox"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('data-slot="alert"');
    expect(html).toContain('data-slot="card-header"');
    expect(html).toContain("custom-modal-content");
    expect(html).toContain('data-slot="accordion-item"');
    expect(html).toContain('data-slot="table-head"');
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
