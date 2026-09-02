import { Button, Icon, Input, Label, Modal, NativeSelect, Textarea } from "@giromesa/ui";
import { type Dispatch, type FormEvent, type SetStateAction, useState } from "react";
import type {
  CatalogProduct,
  PilotCatalog,
  PilotScope,
  SpicinessLevel,
} from "../../../operations.shared";
import { formatMoney } from "../../../rules";
import { hasCatalogProductionStation, toggleCatalogStationId } from "../catalog.stations";
import { CatalogReturnablesSection } from "./CatalogReturnablesSection";

type CatalogProductEditorModalProps = {
  autoTranslateProduct: (
    name: string,
    description?: string | null,
  ) => NonNullable<CatalogProduct["translations"]>;
  busy: string;
  catalog: PilotCatalog;
  editingProduct: CatalogProduct | null;
  editingProductDeliveryPrice: string;
  editingProductPrice: string;
  editingProductReason: string;
  production: boolean;
  scope: PilotScope;
  setEditingProduct: Dispatch<SetStateAction<CatalogProduct | null>>;
  setEditingProductDeliveryPrice: Dispatch<SetStateAction<string>>;
  setEditingProductPrice: Dispatch<SetStateAction<string>>;
  setEditingProductReason: Dispatch<SetStateAction<string>>;
  uploadProductImage: (fileName: string, dataUrl: string) => Promise<string>;
  updateProduct: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
};

export function CatalogProductEditorModal({
  autoTranslateProduct,
  busy,
  catalog,
  editingProduct,
  editingProductDeliveryPrice,
  editingProductPrice,
  editingProductReason,
  setEditingProduct,
  setEditingProductDeliveryPrice,
  setEditingProductPrice,
  setEditingProductReason,
  scope,
  uploadProductImage,
  updateProduct,
}: CatalogProductEditorModalProps) {
  const [imageUploadError, setImageUploadError] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  return (
    <>
      {/* Modal Completo de Edição de Produto, Fotos e Configurações */}
      {editingProduct && (
        <Modal
          isOpen={editingProduct !== null}
          onClose={() => setEditingProduct(null)}
          title={`Editar Item: ${editingProduct.name}`}
          size="lg"
        >
          <form onSubmit={(event) => void updateProduct(event)} className="gm-form-stack">
            {/* Bloco de Foto do Prato */}
            <div className="catalog-editor-photo">
              <div className="catalog-editor-photo__preview">
                {editingProduct.imageUrl ? (
                  <img
                    src={editingProduct.imageUrl}
                    alt="Foto do Prato"
                    className="catalog-editor-photo__image"
                  />
                ) : (
                  <div className="catalog-editor-photo__placeholder">
                    <Icon name="catalog" size={24} />
                  </div>
                )}
              </div>

              <div className="catalog-editor-photo__content">
                <strong className="catalog-editor-photo__title">
                  Foto do Prato para o Cardápio
                </strong>
                <span className="catalog-editor-photo__hint">
                  Exibida no Cardápio Digital QR, no PDV e na impressão. (PNG, JPG ou WEBP até 5MB)
                </span>
                <div className="catalog-editor-photo__actions">
                  <Label className="gm-button gm-button--secondary gm-button--sm catalog-editor-photo__upload">
                    <Icon name="upload" size={12} />
                    <span>{editingProduct.imageUrl ? "Substituir Foto" : "Enviar Foto"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="catalog-editor-photo__input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (
                          !(["image/jpeg", "image/png", "image/webp"] as string[]).includes(
                            file.type,
                          )
                        ) {
                          setImageUploadError("Use uma imagem JPG, PNG ou WEBP.");
                          event.target.value = "";
                          return;
                        }
                        if (file.size > 5 * 1024 * 1024) {
                          setImageUploadError("A foto deve ter no máximo 5 MB.");
                          event.target.value = "";
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = (e) => {
                          const img = new Image();
                          img.onload = async () => {
                            const canvas = document.createElement("canvas");
                            let { width, height } = img;
                            if (width > 800 || height > 800) {
                              if (width > height) {
                                height = Math.round((height * 800) / width);
                                width = 800;
                              } else {
                                width = Math.round((width * 800) / height);
                                height = 800;
                              }
                            }
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext("2d");
                            if (ctx) {
                              ctx.drawImage(img, 0, 0, width, height);
                              setImageUploading(true);
                              setImageUploadError("");
                              try {
                                const imageUrl = await uploadProductImage(
                                  file.name.replace(/\.[^.]+$/, ".jpg"),
                                  canvas.toDataURL("image/jpeg", 0.75),
                                );
                                setEditingProduct({ ...editingProduct, imageUrl });
                              } catch (error) {
                                setImageUploadError(
                                  error instanceof Error
                                    ? error.message
                                    : "Falha ao enviar imagem.",
                                );
                              } finally {
                                setImageUploading(false);
                              }
                            }
                          };
                          img.src = e.target?.result as string;
                        };
                        reader.onerror = () =>
                          setImageUploadError("Não foi possível ler a imagem.");
                        reader.readAsDataURL(file);
                      }}
                    />
                  </Label>
                  {editingProduct.imageUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setEditingProduct({ ...editingProduct, imageUrl: null })}
                      className="catalog-editor-photo__remove"
                    >
                      <Icon name="x" size={12} />
                      <span>Remover</span>
                    </Button>
                  )}
                  {imageUploading && <span role="status">Enviando imagem…</span>}
                  {imageUploadError && <span role="alert">{imageUploadError}</span>}
                </div>
              </div>
            </div>

            {/* Dados Básicos */}
            <div className="gm-form-grid gm-form-grid--split">
              <Label className="gm-field">
                Nome do Prato *
                <Input
                  minLength={2}
                  required
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="gm-control"
                />
              </Label>

              <Label className="gm-field">
                Categoria *
                <NativeSelect
                  value={editingProduct.categoryId}
                  onChange={(e) =>
                    setEditingProduct({ ...editingProduct, categoryId: e.target.value })
                  }
                  className="gm-control catalog-editor-control--select"
                >
                  {catalog.categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
            </div>

            <fieldset className="catalog-create-stations catalog-editor-stations">
              <legend className="catalog-text-strong-078">Estações de produção *</legend>
              <small className="catalog-create-stations__help">
                Cada estação selecionada recebe o item e todas precisam concluir. Mantenha ao menos
                uma.
              </small>
              <div className="catalog-create-stations__options">
                {catalog.stations.map((station) => {
                  const selected = editingProduct.stationIds.includes(station.id);
                  return (
                    <Button
                      aria-pressed={selected}
                      className="catalog-create-station"
                      data-selected={selected || undefined}
                      key={station.id}
                      onClick={() =>
                        setEditingProduct((current) => {
                          if (!current) return current;
                          const stationIds = toggleCatalogStationId(current.stationIds, station.id);
                          return {
                            ...current,
                            stationIds,
                            stationRouting: stationIds.map((stationId) => ({
                              stationId,
                              stage:
                                current.stationRouting?.find(
                                  (route) => route.stationId === stationId,
                                )?.stage ?? 1,
                            })),
                          };
                        })
                      }
                      type="button"
                    >
                      <span className="catalog-create-station__dot" />
                      {station.name}
                    </Button>
                  );
                })}
              </div>
              {editingProduct.stationIds.length > 1 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {editingProduct.stationIds.map((stationId) => (
                    <Label key={stationId}>
                      Etapa · {catalog.stations.find((station) => station.id === stationId)?.name}
                      <NativeSelect
                        onChange={(event) =>
                          setEditingProduct((current) => ({
                            ...(current ?? editingProduct),
                            stationRouting: (current ?? editingProduct).stationIds.map(
                              (currentStationId) => ({
                                stationId: currentStationId,
                                stage:
                                  currentStationId === stationId
                                    ? Number(event.target.value)
                                    : ((current ?? editingProduct).stationRouting?.find(
                                        (route) => route.stationId === currentStationId,
                                      )?.stage ?? 1),
                              }),
                            ),
                          }))
                        }
                        value={
                          editingProduct.stationRouting?.find(
                            (route) => route.stationId === stationId,
                          )?.stage ?? 1
                        }
                      >
                        {[1, 2, 3, 4, 5].map((stage) => (
                          <option key={stage} value={stage}>
                            Etapa {stage}
                          </option>
                        ))}
                      </NativeSelect>
                    </Label>
                  ))}
                </div>
              )}
              {!hasCatalogProductionStation(editingProduct.stationIds) && (
                <span className="catalog-editor-stations__error" role="alert">
                  Selecione ao menos uma estação de produção para salvar.
                </span>
              )}
            </fieldset>

            {/* Preços e Motivo de Auditoria */}
            <div className="gm-form-grid gm-form-grid--3">
              <Label className="gm-field">
                Preço Salão & Balcão (R$) *
                <Input
                  data-currency="brl"
                  value={editingProductPrice}
                  onChange={(e) => setEditingProductPrice(e.target.value)}
                  placeholder="Ex: 38,90"
                  className="gm-control gm-control--strong"
                />
              </Label>

              <Label className="gm-field">
                Preço Delivery (R$)
                <Input
                  data-currency="brl"
                  value={editingProductDeliveryPrice}
                  onChange={(e) => setEditingProductDeliveryPrice(e.target.value)}
                  placeholder="Ex: 44,90"
                  className="gm-control"
                />
              </Label>

              <Label className="gm-field">
                Motivo do Ajuste (Auditoria)
                <Input
                  value={editingProductReason}
                  onChange={(e) => setEditingProductReason(e.target.value)}
                  placeholder="Ex: Reajuste insumos, nova safra..."
                  className="gm-control catalog-editor-control--audit"
                />
              </Label>
            </div>

            <Label className="gm-field">
              Descrição & Ingredientes do Prato
              <Textarea
                rows={2}
                value={editingProduct.description || ""}
                onChange={(e) =>
                  setEditingProduct({ ...editingProduct, description: e.target.value })
                }
                placeholder="Descreva o sabor, ingredientes e detalhes do prato..."
                className="gm-control gm-control--textarea"
              />
            </Label>

            {/* Sanfonas com Configurações Adicionais */}
            <div className="catalog-stack catalog-stack--8">
              {/* Sanfona 1: Opcionais & Modificadores */}
              {catalog.groups.length > 0 && (
                <details className="gm-disclosure catalog-sub-accordion">
                  <summary>
                    <div className="catalog-inline-center-8">
                      <Icon name="plus" size={14} />
                      <span>Grupos de Adicionais & Opcionais Vinculados</span>
                    </div>
                    {(editingProduct.modifierGroupIds || []).length > 0 && (
                      <span className="catalog-text-positive">
                        {(editingProduct.modifierGroupIds || []).length} grupo(s)
                      </span>
                    )}
                  </summary>
                  <div className="gm-disclosure__content catalog-sub-accordion__content">
                    <div className="catalog-editor-options">
                      {catalog.groups.map((grp) => {
                        const isSelected = (editingProduct.modifierGroupIds || []).includes(grp.id);
                        return (
                          <Button
                            key={grp.id}
                            type="button"
                            onClick={() => {
                              const current = editingProduct.modifierGroupIds || [];
                              const next = isSelected
                                ? current.filter((x) => x !== grp.id)
                                : [...current, grp.id];
                              setEditingProduct({
                                ...editingProduct,
                                modifierGroupIds: next,
                              });
                            }}
                            className="catalog-editor-option"
                            data-selected={isSelected || undefined}
                          >
                            <Icon name={isSelected ? "check" : "plus"} size={11} />
                            <span>{grp.name}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </details>
              )}

              {/* Sanfona 2: Selos & Harmonização */}
              <details className="gm-disclosure catalog-sub-accordion">
                <summary>
                  <div className="catalog-inline-center-8">
                    <Icon name="catalog" size={14} />
                    <span>Dica do Sommelier / Chef & Selos</span>
                  </div>
                  {editingProduct.pairingSuggestion && (
                    <span className="catalog-editor-status catalog-editor-status--pairing">
                      Harmonização ativa
                    </span>
                  )}
                </summary>
                <div className="gm-disclosure__content catalog-sub-accordion__content">
                  <Label className="gm-field catalog-field--compact catalog-editor-pairing">
                    Harmonização Recomendada (Dica do Chef / Sommelier)
                    <Input
                      value={editingProduct.pairingSuggestion || ""}
                      onChange={(e) =>
                        setEditingProduct({
                          ...editingProduct,
                          pairingSuggestion: e.target.value,
                        })
                      }
                      placeholder="Ex: Harmoniza perfeitamente com Vinho Pinot Noir ou Cerveja IPA"
                      className="catalog-control-36 catalog-editor-control--audit"
                    />
                  </Label>

                  <div className="catalog-grid-2 catalog-grid-2--compact">
                    <Label className="gm-field catalog-field--compact">
                      Nível de Picância
                      <NativeSelect
                        value={editingProduct.spiciness || "none"}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            spiciness: e.target.value as SpicinessLevel,
                          })
                        }
                        className="catalog-control-36"
                      >
                        <option value="none">Sem Pimenta</option>
                        <option value="mild">Picância Suave</option>
                        <option value="medium">Picante (Moderado)</option>
                        <option value="hot">Muito Picante (Intenso)</option>
                      </NativeSelect>
                    </Label>

                    <Label className="gm-field catalog-field--compact">
                      Tempo de Preparo Estimado (minutos)
                      <Input
                        type="number"
                        min={0}
                        value={editingProduct.estimatedPrepTimeMinutes ?? ""}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            estimatedPrepTimeMinutes: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        placeholder="Ex: 15"
                        className="catalog-control-36"
                      />
                    </Label>
                  </div>
                </div>
              </details>

              {/* Sanfona 3: Dados Fiscais */}
              <details className="gm-disclosure catalog-sub-accordion">
                <summary>
                  <div className="catalog-inline-center-8">
                    <Icon name="finance" size={14} />
                    <span>Dados Fiscais (NCM / CFOP)</span>
                  </div>
                  {editingProduct.ncm && (
                    <span className="catalog-text-positive">NCM {editingProduct.ncm}</span>
                  )}
                </summary>
                <div className="gm-disclosure__content catalog-sub-accordion__content">
                  <div className="catalog-grid-main">
                    <Label className="gm-field catalog-field--compact">
                      NCM
                      <Input
                        value={editingProduct.ncm || ""}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, ncm: e.target.value })
                        }
                        placeholder="Ex: 2106.90.90"
                        className="catalog-control-34"
                      />
                    </Label>
                    <Label className="gm-field catalog-field--compact">
                      CFOP
                      <Input
                        value={editingProduct.cfop || "5.102"}
                        onChange={(e) =>
                          setEditingProduct({ ...editingProduct, cfop: e.target.value })
                        }
                        className="catalog-control-34"
                      />
                    </Label>
                  </div>
                </div>
              </details>

              {/* Sanfona 4: Tradução Multilíngue (Inglês & Espanhol) */}
              <details className="gm-disclosure catalog-sub-accordion">
                <summary>
                  <div className="catalog-inline-center-8">
                    <Icon name="catalog" size={14} />
                    <span>Traduções Multilíngue (Inglês & Espanhol)</span>
                  </div>
                  {editingProduct.translations?.en?.name && (
                    <span className="catalog-editor-status catalog-editor-status--translation">
                      EN / ES Ativo
                    </span>
                  )}
                </summary>
                <div className="gm-disclosure__content catalog-sub-accordion__content">
                  <div className="catalog-editor-translation__toolbar">
                    <span className="catalog-editor-translation__hint">
                      Permita que turistas e clientes internacionais leiam o cardápio em seu idioma
                      nativo.
                    </span>
                    <Button
                      type="button"
                      onClick={() => {
                        const trans = autoTranslateProduct(
                          editingProduct.name,
                          editingProduct.description,
                        );
                        setEditingProduct({
                          ...editingProduct,
                          translations: trans,
                        });
                      }}
                      className="catalog-editor-translate"
                    >
                      <Icon name="catalog" size={12} />
                      <span>✨ Traduzir Automático</span>
                    </Button>
                  </div>

                  {/* Inglês */}
                  <div className="catalog-editor-language catalog-editor-language--spaced">
                    <strong className="catalog-editor-language__title">🇺🇸 Inglês (English)</strong>
                    <div className="catalog-editor-language__fields">
                      <Input
                        placeholder="Name in English (e.g. Artisanal Cheeseburger)"
                        value={editingProduct.translations?.en?.name || ""}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            translations: {
                              ...editingProduct.translations,
                              en: {
                                ...editingProduct.translations?.en,
                                name: e.target.value,
                              },
                            },
                          })
                        }
                        className="catalog-editor-language__input"
                      />
                      <Textarea
                        rows={1}
                        placeholder="Description in English..."
                        value={editingProduct.translations?.en?.description || ""}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            translations: {
                              ...editingProduct.translations,
                              en: {
                                ...editingProduct.translations?.en,
                                description: e.target.value,
                              },
                            },
                          })
                        }
                        className="catalog-editor-language__textarea"
                      />
                    </div>
                  </div>

                  {/* Espanhol */}
                  <div className="catalog-editor-language">
                    <strong className="catalog-editor-language__title">
                      🇪🇸 Espanhol (Español)
                    </strong>
                    <div className="catalog-editor-language__fields">
                      <Input
                        placeholder="Nombre en Español (ej. Hamburguesa Artesanal)"
                        value={editingProduct.translations?.es?.name || ""}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            translations: {
                              ...editingProduct.translations,
                              es: {
                                ...editingProduct.translations?.es,
                                name: e.target.value,
                              },
                            },
                          })
                        }
                        className="catalog-editor-language__input"
                      />
                      <Textarea
                        rows={1}
                        placeholder="Descripción en Español..."
                        value={editingProduct.translations?.es?.description || ""}
                        onChange={(e) =>
                          setEditingProduct({
                            ...editingProduct,
                            translations: {
                              ...editingProduct.translations,
                              es: {
                                ...editingProduct.translations?.es,
                                description: e.target.value,
                              },
                            },
                          })
                        }
                        className="catalog-editor-language__textarea"
                      />
                    </div>
                  </div>
                </div>
              </details>
            </div>

            {/* Histórico de Auditoria de Preços */}
            <div className="catalog-editor-audit">
              <div className="catalog-editor-audit__heading">
                <Icon name="finance" size={14} />
                <strong className="catalog-editor-audit__title">
                  Histórico de Auditoria de Preços
                </strong>
              </div>
              {editingProduct.priceHistory && editingProduct.priceHistory.length > 0 ? (
                <div className="catalog-editor-audit__history">
                  {editingProduct.priceHistory.map((h) => (
                    <div
                      key={`${h.date}-${h.user}-${h.oldPriceCents}-${h.newPriceCents}`}
                      className="catalog-editor-audit__entry"
                    >
                      <div>
                        <div>
                          <strong>{h.date}</strong> por <em>{h.user}</em>
                        </div>
                        <div className="catalog-editor-audit__reason">
                          Motivo: {h.reason || "Sem motivo informado"}
                        </div>
                      </div>
                      <div className="catalog-editor-audit__prices">
                        <span className="catalog-editor-audit__old-price">
                          {formatMoney(h.oldPriceCents)}
                        </span>
                        {" → "}
                        <span className="catalog-editor-audit__new-price">
                          {formatMoney(h.newPriceCents)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="catalog-editor-audit__empty">
                  Nenhuma alteração de preço registrada ainda para este prato.
                </p>
              )}
            </div>

            <div className="catalog-editor-actions">
              <Button variant="ghost" type="button" onClick={() => setEditingProduct(null)}>
                Cancelar
              </Button>
              <Button
                disabled={
                  busy === "update-product" ||
                  editingProduct.name.trim().length < 2 ||
                  !hasCatalogProductionStation(editingProduct.stationIds)
                }
                type="submit"
                variant="primary"
              >
                {busy === "update-product" ? "Salvando…" : "Salvar Alterações"}
              </Button>
            </div>
          </form>
          <CatalogReturnablesSection productId={editingProduct.id} scope={scope} />
        </Modal>
      )}
    </>
  );
}
