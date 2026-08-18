import { Button, Icon, Modal } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { formatMoney } from "../../rules";

type PendingApproval = {
  requestId: string;
  tabLabel: string | null;
  productName: string;
  action: "discount" | "cancel";
  discountCents: number | null;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  expiresAt: string | null;
};

export function parsePendingApprovals(value: unknown): PendingApproval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.requestId !== "string" ||
      typeof row.productName !== "string" ||
      (row.action !== "discount" && row.action !== "cancel") ||
      typeof row.reason !== "string" ||
      typeof row.requestedByName !== "string" ||
      typeof row.requestedAt !== "string"
    ) {
      return [];
    }
    return [
      {
        requestId: row.requestId,
        tabLabel: typeof row.tabLabel === "string" ? row.tabLabel : null,
        productName: row.productName,
        action: row.action,
        discountCents: typeof row.discountCents === "number" ? row.discountCents : null,
        reason: row.reason,
        requestedByName: row.requestedByName,
        requestedAt: row.requestedAt,
        expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
      },
    ];
  });
}

export function ManagerApprovalInbox({
  organizationId,
  unitId,
  profileId,
  disabled = false,
  onChanged,
}: {
  organizationId: string;
  unitId: string;
  profileId: string;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<PendingApproval[]>([]);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const previousCount = useRef(0);
  const canApprove = !disabled && ["owner", "manager"].includes(profileId);

  const refresh = useCallback(async () => {
    try {
      const next = parsePendingApprovals(await api.pilot.approvalRequests(organizationId, unitId));
      if (next.length > previousCount.current) navigator.vibrate?.(80);
      previousCount.current = next.length;
      setItems(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [organizationId, unitId]);

  useEffect(() => {
    if (!canApprove) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [canApprove, refresh]);

  if (!canApprove || (items.length === 0 && !loadError)) return null;

  async function decide(requestId: string, decision: "approve" | "reject") {
    if (pin.length < 4) {
      setNotice("Informe seu código gerencial.");
      return;
    }
    setBusyId(requestId);
    setNotice("");
    try {
      await api.pilot.decideApproval(
        organizationId,
        unitId,
        requestId,
        decision,
        { pin },
        crypto.randomUUID(),
      );
      setItems((current) => current.filter((item) => item.requestId !== requestId));
      setNotice(decision === "approve" ? "Ajuste autorizado e aplicado." : "Solicitação recusada.");
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível concluir a decisão.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-label={
          loadError
            ? "Falha ao consultar solicitações gerenciais"
            : `${items.length} solicitação(ões) gerencial(is) pendente(s)`
        }
        className={`manager-inbox-trigger ${loadError ? "manager-inbox-trigger--error" : ""}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Icon name="alerts" size={17} />
        {!loadError && <span>{items.length}</span>}
      </button>
      <Modal
        className="manager-inbox-modal"
        isOpen={open}
        onClose={() => setOpen(false)}
        size="md"
        title="Solicitações gerenciais"
      >
        <section aria-live="polite" className="manager-inbox">
          {loadError ? (
            <div className="manager-inbox__empty">
              <strong>Não foi possível atualizar as solicitações</strong>
              <small>Verifique a conexão e tente novamente.</small>
              <Button onClick={() => void refresh()} size="sm" variant="secondary">
                Tentar novamente
              </Button>
            </div>
          ) : (
            <>
              <label className="manager-inbox__pin">
                Código gerencial
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                  placeholder="••••"
                  type="password"
                  value={pin}
                />
              </label>
              <div className="manager-inbox__list">
                {items.map((item) => (
                  <article key={item.requestId}>
                    <div className="manager-inbox__request">
                      <span>{item.action === "discount" ? "Desconto" : "Cancelamento"}</span>
                      <strong>
                        {item.tabLabel ?? "Conta"} · {item.productName}
                      </strong>
                      <small>
                        Solicitado por {item.requestedByName} ·{" "}
                        {new Date(item.requestedAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                      {item.action === "discount" && <b>{formatMoney(item.discountCents ?? 0)}</b>}
                      <p>{item.reason}</p>
                      {item.expiresAt && (
                        <time dateTime={item.expiresAt}>
                          Expira às{" "}
                          {new Date(item.expiresAt).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      )}
                    </div>
                    <div className="manager-inbox__actions">
                      <Button
                        disabled={busyId === item.requestId}
                        onClick={() => void decide(item.requestId, "reject")}
                        size="sm"
                        variant="ghost"
                      >
                        Recusar
                      </Button>
                      <Button
                        disabled={busyId === item.requestId}
                        onClick={() => void decide(item.requestId, "approve")}
                        size="sm"
                      >
                        Autorizar
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {notice && <p className="manager-inbox__notice">{notice}</p>}
        </section>
      </Modal>
    </>
  );
}
