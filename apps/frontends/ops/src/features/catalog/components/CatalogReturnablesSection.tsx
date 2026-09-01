import { Button, Input, NativeSelect } from "@giromesa/ui";
import { useEffect, useMemo, useState } from "react";
import { ApiClientError, api } from "../../../api";
import { parseInventory, parseReturnables, useRemote } from "../../../management.shared";
import type { PilotScope } from "../../../operations.shared";
import {
  activeReturnableContainers,
  buildCatalogReturnablePayload,
  type CatalogReturnableMappingDraft,
  type CatalogReturnableStatus,
  readCatalogReturnableDraft,
} from "../catalog.returnables";

function emptyMapping(): CatalogReturnableMappingDraft {
  return {
    key: crypto.randomUUID(),
    containerInventoryItemId: "",
    quantityPerUnit: "1",
    deposit: "0,00",
  };
}

export function CatalogReturnablesSection({
  productId,
  scope,
}: {
  productId: string;
  scope: PilotScope;
}) {
  const inventory = useRemote(scope, api.management.inventory, parseInventory);
  const returnables = useRemote(scope, api.management.returnables, parseReturnables);
  const [initializedProductId, setInitializedProductId] = useState("");
  const [status, setStatus] = useState<CatalogReturnableStatus>("");
  const [mappings, setMappings] = useState<CatalogReturnableMappingDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [writeDenied, setWriteDenied] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string }>();

  useEffect(() => {
    if (returnables.state.status !== "ready" || initializedProductId === productId) return;
    const draft = readCatalogReturnableDraft(
      productId,
      returnables.state.data.classificationStatus,
      returnables.state.data.configurations,
    );
    setStatus(draft.status);
    setMappings(
      draft.status === "returnable" && !draft.mappings.length ? [emptyMapping()] : draft.mappings,
    );
    setMessage(undefined);
    setInitializedProductId(productId);
  }, [initializedProductId, productId, returnables.state]);

  const containers = useMemo(
    () =>
      inventory.state.status === "ready"
        ? activeReturnableContainers(inventory.state.data.items)
        : [],
    [inventory.state],
  );
  const itemById = useMemo(
    () =>
      new Map(
        inventory.state.status === "ready"
          ? inventory.state.data.items.map((item) => [item.id, item])
          : [],
      ),
    [inventory.state],
  );
  const permissionDenied =
    writeDenied ||
    (returnables.state.status === "error" &&
      (returnables.state.httpStatus === 401 || returnables.state.httpStatus === 403)) ||
    (returnables.state.status === "ready" &&
      returnables.state.data.capabilities?.canConfigureReturnables !== true);
  const canEdit =
    returnables.state.status === "ready" &&
    inventory.state.status === "ready" &&
    !writeDenied &&
    returnables.state.data.capabilities?.canConfigureReturnables === true;

  function updateMapping(key: string, patch: Partial<CatalogReturnableMappingDraft>) {
    setMappings((current) =>
      current.map((mapping) => (mapping.key === key ? { ...mapping, ...patch } : mapping)),
    );
    setMessage(undefined);
  }

  async function save() {
    const result = buildCatalogReturnablePayload(status, mappings);
    if (!result.payload) {
      setMessage({ tone: "danger", text: result.error ?? "Revise a configuração." });
      return;
    }
    const activeContainerIds = new Set(containers.map((container) => container.id));
    if (
      result.payload.status === "returnable" &&
      result.payload.mappings.some(
        (mapping) => !activeContainerIds.has(mapping.containerInventoryItemId),
      )
    ) {
      setMessage({
        tone: "danger",
        text: "Selecione somente vasilhames retornáveis ativos.",
      });
      return;
    }

    setSaving(true);
    setMessage(undefined);
    try {
      await api.management.configureReturnableProduct(
        scope.organizationId,
        scope.unitId,
        productId,
        result.payload,
      );
      setMessage({ tone: "success", text: "Embalagens retornáveis salvas." });
      returnables.retry();
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403))
        setWriteDenied(true);
      setMessage({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar as embalagens retornáveis.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="catalog-returnables" aria-labelledby="catalog-returnables-title">
      <div className="catalog-returnables__heading">
        <div>
          <p className="eyebrow">Estoque e custódia</p>
          <h3 id="catalog-returnables-title">Embalagens retornáveis</h3>
        </div>
        <span>Salvamento separado do produto</span>
      </div>
      <p className="catalog-returnables__copy">
        Vincule garrafas, caixas ou outros vasilhames persistidos no estoque. Cada venda gera o
        retorno esperado nas quantidades informadas.
      </p>

      {(returnables.state.status === "loading" || inventory.state.status === "loading") && (
        <p className="catalog-returnables__notice" role="status">
          Carregando configuração e vasilhames…
        </p>
      )}
      {returnables.state.status === "error" && (
        <div
          className="catalog-returnables__notice catalog-returnables__notice--warning"
          role="alert"
        >
          <span>
            {permissionDenied
              ? "Sem permissão para configurar retornáveis. A edição normal do produto continua disponível."
              : returnables.state.message}
          </span>
          {!permissionDenied && (
            <Button onClick={returnables.retry} size="sm" type="button" variant="ghost">
              Tentar novamente
            </Button>
          )}
        </div>
      )}

      {returnables.state.status === "ready" && (
        <>
          {permissionDenied && (
            <p
              className="catalog-returnables__notice catalog-returnables__notice--warning"
              role="status"
            >
              Sem permissão para configurar. Solicite acesso de estoque ao responsável.
            </p>
          )}
          {!status && (
            <p className="catalog-returnables__notice" role="status">
              A classificação deste produto ainda não foi definida.
            </p>
          )}
          {inventory.state.status === "error" && (
            <div
              className="catalog-returnables__notice catalog-returnables__notice--warning"
              role="alert"
            >
              <span>
                Não foi possível carregar os vasilhames. A configuração atual foi preservada.
              </span>
              <Button onClick={inventory.retry} size="sm" type="button" variant="ghost">
                Tentar novamente
              </Button>
            </div>
          )}

          <fieldset className="catalog-returnables__status" disabled={!canEdit || saving}>
            <legend>Este produto usa embalagem retornável?</legend>
            <label>
              <input
                checked={status === "non_returnable"}
                name={`returnable-status-${productId}`}
                onChange={() => {
                  setStatus("non_returnable");
                  setMessage(undefined);
                }}
                type="radio"
              />
              <span>
                <strong>Não retornável</strong>
                <small>Não cria custódia nem retorno esperado.</small>
              </span>
            </label>
            <label>
              <input
                checked={status === "returnable"}
                name={`returnable-status-${productId}`}
                onChange={() => {
                  setStatus("returnable");
                  setMappings((current) => (current.length ? current : [emptyMapping()]));
                  setMessage(undefined);
                }}
                type="radio"
              />
              <span>
                <strong>Retornável</strong>
                <small>Exige ao menos um vínculo com vasilhame ativo.</small>
              </span>
            </label>
          </fieldset>

          {status === "returnable" && (
            <div className="catalog-returnables__mappings">
              {mappings.map((mapping, index) => {
                const selectedElsewhere = new Set(
                  mappings
                    .filter((candidate) => candidate.key !== mapping.key)
                    .map((candidate) => candidate.containerInventoryItemId),
                );
                const selectedItem = itemById.get(mapping.containerInventoryItemId);
                const selectedIsActive = containers.some(
                  (container) => container.id === mapping.containerInventoryItemId,
                );
                return (
                  <fieldset className="catalog-returnables__mapping" key={mapping.key}>
                    <legend>Vínculo {index + 1}</legend>
                    <label
                      className="gm-form-field catalog-returnables__container"
                      htmlFor={`${mapping.key}-container`}
                    >
                      <span>Vasilhame</span>
                      <NativeSelect
                        disabled={!canEdit || saving}
                        id={`${mapping.key}-container`}
                        onChange={(event) =>
                          updateMapping(mapping.key, {
                            containerInventoryItemId: event.target.value,
                          })
                        }
                        value={mapping.containerInventoryItemId}
                      >
                        <option value="">Selecione</option>
                        {mapping.containerInventoryItemId && !selectedIsActive && (
                          <option disabled value={mapping.containerInventoryItemId}>
                            {selectedItem?.name ?? "Vasilhame indisponível"} (inativo)
                          </option>
                        )}
                        {containers.map((container) => (
                          <option
                            disabled={selectedElsewhere.has(container.id)}
                            key={container.id}
                            value={container.id}
                          >
                            {container.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="gm-form-field" htmlFor={`${mapping.key}-quantity`}>
                      <span>Quantidade por venda</span>
                      <Input
                        disabled={!canEdit || saving}
                        id={`${mapping.key}-quantity`}
                        inputMode="decimal"
                        min="0.001"
                        onChange={(event) =>
                          updateMapping(mapping.key, { quantityPerUnit: event.target.value })
                        }
                        required
                        step="0.001"
                        type="number"
                        value={mapping.quantityPerUnit}
                      />
                    </label>
                    <label className="gm-form-field" htmlFor={`${mapping.key}-deposit`}>
                      <span>Caução por vasilhame (R$)</span>
                      <Input
                        disabled={!canEdit || saving}
                        id={`${mapping.key}-deposit`}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          updateMapping(mapping.key, { deposit: event.target.value })
                        }
                        required
                        step="0.01"
                        type="number"
                        value={mapping.deposit.replace(",", ".")}
                      />
                    </label>
                    <Button
                      aria-label={`Remover vínculo ${index + 1}`}
                      disabled={!canEdit || saving || mappings.length === 1}
                      onClick={() =>
                        setMappings((current) =>
                          current.filter((candidate) => candidate.key !== mapping.key),
                        )
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Remover
                    </Button>
                  </fieldset>
                );
              })}
              {!containers.length && inventory.state.status === "ready" && (
                <div className="catalog-returnables__notice catalog-returnables__notice--warning">
                  <span>
                    Cadastre primeiro um item ativo do tipo “Vasilhame retornável” no Estoque.
                  </span>
                  <a
                    className="gm-button gm-button--secondary gm-button--sm"
                    href="#/inventory?inventoryView=returnables"
                  >
                    Abrir Estoque → Vasilhames
                  </a>
                </div>
              )}
              <Button
                disabled={!canEdit || saving || mappings.length >= containers.length}
                onClick={() => setMappings((current) => [...current, emptyMapping()])}
                size="sm"
                type="button"
                variant="secondary"
              >
                Adicionar vasilhame
              </Button>
            </div>
          )}

          <div className="catalog-returnables__actions">
            {message && (
              <p
                className={`catalog-returnables__feedback ${message.tone}`}
                role={message.tone === "danger" ? "alert" : "status"}
              >
                {message.text}
              </p>
            )}
            <Button
              disabled={!canEdit || saving}
              onClick={() => void save()}
              size="sm"
              type="button"
            >
              {saving ? "Salvando…" : "Salvar retornáveis"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
