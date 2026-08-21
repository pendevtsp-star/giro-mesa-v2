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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@giromesa/ui";
import { useState } from "react";
import { api } from "../../api";
import type { KdsData, PilotScope } from "../../operations.shared";

const key = () => globalThis.crypto.randomUUID();

export function KdsAdvancedPanels({
  data,
  scope,
  installationId,
  mode,
  refresh,
}: {
  data: KdsData;
  scope: PilotScope;
  installationId: string;
  mode: "station" | "pass";
  refresh: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (actionKey: string, action: () => Promise<unknown>) => {
    setBusy(actionKey);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a ação.");
    } finally {
      setBusy(null);
    }
  };
  const pendingChanges = data.items.flatMap(({ ticketId, item }) =>
    item.changes
      .filter((change) => !change.acknowledgedAt)
      .map((change) => ({ ticketId, item, change })),
  );
  const runnerOrders = [
    ...new Map(data.tickets.map((ticket) => [ticket.orderId, ticket])).values(),
  ].filter((ticket) => ticket.handedOffAt && !ticket.servedAt);

  return (
    <div className="grid gap-4" data-kds-advanced>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Ação não concluída</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pendingChanges.length > 0 && (
        <Alert role="alert">
          <AlertTitle>Alterações após o envio</AlertTitle>
          <AlertDescription>
            <div className="grid gap-2">
              {pendingChanges.map(({ ticketId, item, change }) => (
                <div className="flex flex-wrap items-center justify-between gap-2" key={change.id}>
                  <span>
                    <strong>{item.productName}:</strong> {change.summary}
                  </span>
                  <Button
                    disabled={busy === change.id}
                    onClick={() =>
                      run(change.id, () =>
                        api.pilot.acknowledgeKdsChange(
                          scope.organizationId,
                          scope.unitId,
                          ticketId,
                          change.id,
                          change.revision,
                          key(),
                        ),
                      )
                    }
                    size="sm"
                  >
                    Confirmar ciência
                  </Button>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {data.demand && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Ritmo da operação</CardTitle>
            <Badge tone={data.demand.state === "overloaded" ? "danger" : "info"}>
              {data.demand.state === "normal"
                ? "Normal"
                : data.demand.state === "strained"
                  ? "Pressionado"
                  : "Sobrecarregado"}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-2">
            <p>
              Acréscimo recomendado: <strong>{data.demand.suggestedDelayMinutes} min</strong>. A
              decisão permanece manual.
            </p>
            <div className="flex flex-wrap gap-2">
              {data.demand.channels.map((channel) => (
                <Badge key={channel.channel} tone="neutral">
                  {channel.channel}: {channel.activeOrders} pedidos · +
                  {channel.suggestedDelayMinutes} min
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "station" && data.capabilities.productionGrid && data.productionGrid.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Produção por item</CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion>
              {data.productionGrid.map((group) => {
                const recipe = data.items.find(
                  ({ item }) => item.productId === group.productId && item.recipe.length > 0,
                )?.item.recipe;
                return (
                  <AccordionItem key={`${group.stationId}:${group.productId}`}>
                    <AccordionTrigger>
                      {group.productName} · {group.totalQuantity} unidades
                    </AccordionTrigger>
                    <AccordionContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Pedido</TableHead>
                            <TableHead>Etapa</TableHead>
                            <TableHead>Quantidade</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Atribuição</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.assignments.map((assignment) => {
                            const ticket = data.tickets.find(
                              (row) => row.id === assignment.ticketId,
                            );
                            const claimedHere = ticket?.claimedByInstallationId === installationId;
                            const claimedElsewhere = Boolean(
                              ticket?.claimedByInstallationId && !claimedHere,
                            );
                            return (
                              <TableRow key={`${assignment.ticketId}:${assignment.orderItemId}`}>
                                <TableCell>{assignment.reference}</TableCell>
                                <TableCell>{assignment.stage}</TableCell>
                                <TableCell>
                                  {assignment.readyQuantity}/{assignment.quantity}
                                </TableCell>
                                <TableCell>{assignment.status}</TableCell>
                                <TableCell>
                                  {data.capabilities.ticketClaim && ticket && (
                                    <Button
                                      disabled={busy === ticket.id || claimedElsewhere}
                                      onClick={() =>
                                        run(ticket.id, () =>
                                          claimedHere
                                            ? api.pilot.releaseKdsTicketClaim(
                                                scope.organizationId,
                                                scope.unitId,
                                                ticket.id,
                                                installationId,
                                                key(),
                                              )
                                            : api.pilot.claimKdsTicket(
                                                scope.organizationId,
                                                scope.unitId,
                                                ticket.id,
                                                installationId,
                                                key(),
                                              ),
                                        )
                                      }
                                      size="sm"
                                      variant="secondary"
                                    >
                                      {claimedHere
                                        ? "Liberar"
                                        : claimedElsewhere
                                          ? "Em outro terminal"
                                          : "Assumir"}
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {recipe && (
                        <details className="mt-3">
                          <summary className="cursor-pointer font-medium">Ver montagem</summary>
                          <ul className="mt-2 list-disc pl-5">
                            {recipe.map((component) => (
                              <li key={component.id}>
                                {component.ingredientName}: {component.quantityMilli / 1000}{" "}
                                {component.unit}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {mode === "pass" && data.capabilities.runnerHandoff && runnerOrders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saída com runner</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {runnerOrders.map((ticket) => (
              <div
                className="flex flex-wrap items-center justify-between gap-2"
                key={ticket.orderId}
              >
                <span>{ticket.reference ?? ticket.tabLabel ?? ticket.orderId}</span>
                {!ticket.runnerIdentityId ? (
                  <Button
                    disabled={busy === ticket.orderId}
                    onClick={() =>
                      run(ticket.orderId, () =>
                        api.pilot.claimKdsRunner(
                          scope.organizationId,
                          scope.unitId,
                          ticket.orderId,
                          undefined,
                          key(),
                        ),
                      )
                    }
                    size="sm"
                  >
                    Assumir entrega
                  </Button>
                ) : !ticket.runnerPickedUpAt ? (
                  <Button
                    disabled={busy === ticket.orderId}
                    onClick={() =>
                      run(ticket.orderId, () =>
                        api.pilot.handoffKds(
                          scope.organizationId,
                          scope.unitId,
                          ticket.orderId,
                          "runner",
                          undefined,
                          key(),
                        ),
                      )
                    }
                    size="sm"
                  >
                    Retirar no passe
                  </Button>
                ) : (
                  <Button
                    disabled={busy === ticket.orderId}
                    onClick={() =>
                      run(ticket.orderId, () =>
                        api.pilot.handoffKds(
                          scope.organizationId,
                          scope.unitId,
                          ticket.orderId,
                          "served",
                          undefined,
                          key(),
                        ),
                      )
                    }
                    size="sm"
                  >
                    Confirmar entrega
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
