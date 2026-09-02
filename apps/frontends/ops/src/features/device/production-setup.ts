import type { ProductionPrinter } from "../../api";

export const productionSetupSteps = [
  { id: "computer", label: "Conectar computador" },
  { id: "printer", label: "Adicionar impressora" },
  { id: "stations", label: "Organizar preparo" },
  { id: "routing", label: "Distribuir cardápio" },
  { id: "check", label: "Testar e concluir" },
] as const;

export type ProductionSetupStep = (typeof productionSetupSteps)[number]["id"];

export function productionSetupReadiness(
  hubs: Array<{ online: boolean }>,
  printers: Array<Pick<ProductionPrinter, "active" | "documentTypes" | "lastStatus">>,
  stations: Array<{ active: boolean; readiness: { ready: boolean } }>,
  routingReady: boolean,
): Record<ProductionSetupStep, boolean> {
  const computer = hubs.some((hub) => hub.online);
  const printer = printers.some(
    (item) =>
      item.active !== false &&
      item.documentTypes.includes("kds_ticket") &&
      item.lastStatus === "online",
  );
  const activeStations = stations.filter((station) => station.active);
  const stationsReady =
    activeStations.length > 0 && activeStations.every((station) => station.readiness.ready);

  return {
    computer,
    printer,
    stations: stationsReady,
    routing: routingReady,
    check: computer && printer && stationsReady && routingReady,
  };
}

export function firstIncompleteProductionStep(
  readiness: Record<ProductionSetupStep, boolean>,
): ProductionSetupStep {
  return productionSetupSteps.find((step) => !readiness[step.id])?.id ?? "check";
}
