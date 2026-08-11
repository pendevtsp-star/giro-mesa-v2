import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildKdsBoardModel,
  classifyKdsSla,
  KdsBoard,
  type KdsBoardTicket,
  nextKdsBoardState,
} from "./kds-board";

const tickets: KdsBoardTicket[] = [
  {
    id: "regular",
    reference: "Mesa 08",
    station: "Cozinha",
    status: "pending",
    elapsedMinutes: 4,
    items: [{ id: "i1", label: "1× Risoto" }],
  },
  {
    id: "late",
    reference: "Mesa 12",
    station: "Bar",
    status: "preparing",
    elapsedMinutes: 24,
    priority: true,
    items: [{ id: "i2", label: "2× Negroni", notes: "Sem gelo" }],
  },
];

describe("KDS de produção", () => {
  it("ordena prioridade e SLA sem depender apenas de cor", () => {
    const model = buildKdsBoardModel(tickets, "Todas");
    expect(model.visible.map((ticket) => ticket.id)).toEqual(["late", "regular"]);
    const late = tickets[1];
    const regular = tickets[0];
    expect(late).toBeDefined();
    expect(regular).toBeDefined();
    if (!late || !regular) throw new Error("Fixture incompleta");
    expect(classifyKdsSla(late)).toEqual({ level: "critical", label: "SLA estourado" });
    expect(classifyKdsSla(regular)).toEqual({ level: "on-track", label: "No prazo" });
  });

  it("mantém as transições explícitas e renderiza filtros, dispositivo e notas", () => {
    expect(nextKdsBoardState("pending")).toBe("preparing");
    expect(nextKdsBoardState("preparing")).toBe("ready");
    expect(nextKdsBoardState("ready")).toBe("done");
    const html = renderToStaticMarkup(
      <KdsBoard deviceState="degraded" onAdvance={() => undefined} tickets={tickets} />,
    );
    expect(html).toContain("Todas as estações");
    expect(html).toContain("Conexão instável");
    expect(html).toContain("PRIORIDADE");
    expect(html).toContain("SLA estourado");
    expect(html).toContain("Sem gelo");
    expect(html).toContain("Desfazer por 5s");
  });
});
