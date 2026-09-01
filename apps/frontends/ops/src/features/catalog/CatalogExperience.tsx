import { Button, Icon, Input, Label, Modal, NativeSelect, Textarea, Toast } from "@giromesa/ui";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  api,
  type CatalogBcgProduct,
  type CatalogPublication,
  type CatalogTableQr,
} from "../../api";
import {
  type CatalogProduct,
  type DietaryTag,
  type ModifierGroup,
  type PilotCatalog,
  type PilotCatalogCategory,
  type PilotScope,
  type ProductSizeVariation,
  priceToCents,
  type RecipeIngredient,
  type SpicinessLevel,
  slugify,
} from "../../operations.shared";
import { routeHref } from "../../router";
import { formatMoney } from "../../rules";
import {
  type CatalogCsvRow,
  catalogCsvTemplate,
  parseCatalogCsv,
  serializeCatalogCsv,
} from "./catalog.csv";
import { buildTableQrPrintHtml, escapeCatalogHtml, selectTableQrRows } from "./catalog.print";
import {
  hasCatalogProductionStation,
  normalizeCatalogStationIds,
  toggleCatalogStationId,
} from "./catalog.stations";
import { autoTranslateProduct } from "./catalog.translation";
import { CatalogBcgModal } from "./components/CatalogBcgModal";
import { CatalogFilters } from "./components/CatalogFilters";
import { CatalogManagementHeader } from "./components/CatalogManagementHeader";
import { CatalogProductEditorModal } from "./components/CatalogProductEditorModal";
import { CatalogProductsPanel } from "./components/CatalogProductsPanel";
import { CatalogPromotionsModal } from "./components/CatalogPromotionsModal";
import { CatalogSpreadsheetModal } from "./components/CatalogSpreadsheetModal";

export function CatalogExperience({
  initialCatalog,
  onRetry,
  scope,
}: {
  initialCatalog: PilotCatalog;
  onRetry?: () => void;
  scope: PilotScope;
}) {
  const [catalog, setCatalog] = useState<PilotCatalog>(initialCatalog);

  useEffect(() => {
    setCatalog(initialCatalog);
  }, [initialCatalog]);

  const [categoryName, setCategoryName] = useState("");
  const [stationName, setStationName] = useState("");
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFileName, setImageFileName] = useState("");
  const [price, setPrice] = useState("");
  const [deliveryPrice, setDeliveryPrice] = useState("");
  const [cost, setCost] = useState("");
  const [selectedTags, setSelectedTags] = useState<
    Array<"chef_special" | "bestseller" | "new" | "promo">
  >([]);
  const [suggestedProducts, setSuggestedProducts] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [stationIds, setStationIds] = useState<string[]>([]);
  const [estimatedPrepTimeMinutes, setEstimatedPrepTimeMinutes] = useState<number | "">("");
  const [allergenName, setAllergenName] = useState("");
  const [allergenCode, _setAllergenCode] = useState("");
  const [modifierName, setModifierName] = useState("");
  const [modifierMin, setModifierMin] = useState(0);
  const [modifierMax, setModifierMax] = useState(1);
  const [modifierOptionsText, setModifierOptionsText] = useState("");
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);

  const [busy, setBusy] = useState("");
  const [feedback, setFeedbackMessage] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"danger" | "success">("success");

  function setFeedback(message: string, tone: "danger" | "success" = "success") {
    setFeedbackMessage(message);
    setFeedbackTone(tone);
  }
  const [search, setSearch] = useState("");
  const [selectedTabCategoryId, setSelectedTabCategoryId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("active");

  const [viewMode, setViewMode] = useState<"list" | "grid" | "table">("list");

  // Dados Fiscais Form State
  const [productNcm, setProductNcm] = useState("2106.90.90");
  const [productCfop, setProductCfop] = useState("5.102");
  const productCest = "";
  const productOrigin = 0;

  async function updateProductInlinePrice(productId: string, newPriceCents: number) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (!product) {
      setFeedback("Produto não encontrado. Atualize o cardápio e tente novamente.", "danger");
      return;
    }

    setBusy(`price-${productId}`);
    try {
      await api.pilot.updateProductUnitConfig(scope.organizationId, scope.unitId, productId, {
        priceCents: newPriceCents,
        available: product.available,
        stationIds: normalizeCatalogStationIds(product.stationIds),
        availabilitySchedule: product.availabilitySchedule ?? null,
      });
      setFeedback("Preço do produto atualizado.");
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao atualizar preço.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function updateProductInlineDeliveryPrice(
    productId: string,
    newDeliveryPriceCents: number,
  ) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (!product) {
      setFeedback("Produto não encontrado. Atualize o cardápio e tente novamente.", "danger");
      return;
    }

    setBusy(`delivery-price-${productId}`);
    try {
      await api.pilot.updateProductUnitConfig(scope.organizationId, scope.unitId, productId, {
        priceCents: product.priceCents,
        deliveryPriceCents: newDeliveryPriceCents,
        costCents: product.costCents ?? null,
        available: product.available,
        stationIds: normalizeCatalogStationIds(product.stationIds),
        availabilitySchedule: product.availabilitySchedule ?? null,
        dailyStock: product.dailyStockLimit ?? null,
        autoDeductStock: product.autoDeductStock,
      });
      setFeedback("Preço de delivery atualizado.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao atualizar preço de delivery.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [scheduleDays, setScheduleDays] = useState<"all" | "weekdays" | "weekend">("all");
  const [dailyStockLimit, setDailyStockLimit] = useState<string>("");

  const [matrixModalOpen, setMatrixModalOpen] = useState(false);
  const [qrPreviewModalOpen, setQrPreviewModalOpen] = useState(false);
  const [printableLabelsModalOpen, setPrintableLabelsModalOpen] = useState(false);
  const [selectedAllergenFilter, setSelectedAllergenFilter] = useState<string>("all");
  const [selectedQrTable, setSelectedQrTable] = useState<number>(1);
  const [clientSimulatorCart, setClientSimulatorCart] = useState<Record<string, number>>({});
  const [bcgProducts, setBcgProducts] = useState<CatalogBcgProduct[]>([]);
  const [publication, setPublication] = useState<CatalogPublication | null>(null);
  const [tableQrs, setTableQrs] = useState<Array<CatalogTableQr & { dataUrl: string }>>([]);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<string>("all");
  const [bulkChannel, setBulkChannel] = useState<"salon" | "delivery" | "both">("both");
  const [bulkType, setBulkType] = useState<"percentage" | "fixed">("percentage");
  const [bulkValue, setBulkValue] = useState<string>("10");

  const [editingCategory, setEditingCategory] = useState<{
    id: string;
    name: string;
    description: string;
    salonChannel: boolean;
    qrMesaChannel: boolean;
    deliveryChannel: boolean;
    hasSchedule: boolean;
    startTime: string;
    endTime: string;
    defaultStationId: string;
  } | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [modifiersManagerModalOpen, setModifiersManagerModalOpen] = useState(false);
  const [promosAndCombosModalOpen, setPromosAndCombosModalOpen] = useState(false);
  const [pdfExportModalOpen, setPdfExportModalOpen] = useState(false);
  const [pdfLayoutMode, setPdfLayoutMode] = useState<"modern" | "bistro">("modern");
  const [pdfShowPhotos, setPdfShowPhotos] = useState(true);
  const [pdfShowDescriptions, setPdfShowDescriptions] = useState(true);
  const [pdfShowQr, setPdfShowQr] = useState(true);
  const [modifierCustomizerProduct, setModifierCustomizerProduct] = useState<CatalogProduct | null>(
    null,
  );
  const [customizerSelections, setCustomizerSelections] = useState<Record<string, string[]>>({});

  // Novo Grupo de Modificadores State
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMin, setNewGroupMin] = useState(0);
  const [newGroupMax, setNewGroupMax] = useState(1);
  const [newOptionName, setNewOptionName] = useState("");
  const [newOptionPrice, setNewOptionPrice] = useState("");
  const createAttempts = useRef(new Map<string, { fingerprint: string; key: string }>());

  function createAttemptKey(operation: string, body: unknown) {
    const fingerprint = JSON.stringify(body);
    const current = createAttempts.current.get(operation);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = crypto.randomUUID();
    createAttempts.current.set(operation, { fingerprint, key });
    return key;
  }

  function completeCreateAttempt(operation: string) {
    createAttempts.current.delete(operation);
  }

  async function uploadProductImage(fileName: string, dataUrl: string) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl);
    const mimeType = match?.[1];
    const base64 = match?.[2];
    if (!mimeType || !base64) throw new Error("Formato de imagem não suportado.");
    const result = await api.pilot.uploadCatalogMedia(scope.organizationId, scope.unitId, {
      fileName,
      mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp",
      base64,
    });
    return result.url;
  }

  async function openBcgMatrix() {
    setBusy("bcg");
    try {
      const result = await api.pilot.catalogBcg(scope.organizationId, scope.unitId);
      setBcgProducts(result.products);
      setMatrixModalOpen(true);
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao carregar análise BCG.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function ensurePublication() {
    const current = await api.pilot.catalogPublication(scope.organizationId, scope.unitId);
    if (current?.active) return current;
    const body = {
      slug: current?.slug || `${slugify(restaurantName) || "cardapio"}-${scope.unitId.slice(0, 8)}`,
      active: true,
    };
    return api.pilot.updateCatalogPublication(
      scope.organizationId,
      scope.unitId,
      body,
      createAttemptKey("catalog-publication", body),
    );
  }

  async function loadRealTableQrs() {
    const currentPublication = await ensurePublication();
    if (currentPublication) {
      completeCreateAttempt("catalog-publication");
      setPublication(currentPublication);
    }
    const rows = await api.pilot.catalogTableQrs(scope.organizationId, scope.unitId);
    const rendered = await Promise.all(
      selectTableQrRows(rows, new Set(rows.map((row) => row.tableId))).map(async (row) => {
        const svg = await QRCode.toString(row.url, {
          type: "svg",
          errorCorrectionLevel: "H",
          margin: 4,
          width: 768,
        });
        return {
          ...row,
          dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        };
      }),
    );
    setTableQrs(rendered);
    if (rendered[0]) setSelectedQrTable(0);
    return rendered;
  }

  async function openCustomerPreview() {
    const previewWindow = window.open("about:blank", "_blank");
    if (previewWindow) previewWindow.opener = null;
    setBusy("customer-preview");
    try {
      const currentPublication = await ensurePublication();
      if (!currentPublication?.url) throw new Error("A publicação não retornou uma URL válida.");
      completeCreateAttempt("catalog-publication");
      setPublication(currentPublication);
      if (previewWindow) {
        previewWindow.location.replace(currentPublication.url);
      } else {
        setFeedback(`Cardápio publicado em ${currentPublication.url}`);
      }
    } catch (error) {
      previewWindow?.close();
      setFeedback(error instanceof Error ? error.message : "Falha ao publicar cardápio.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function openPrintableLabels() {
    setBusy("table-labels");
    try {
      await loadRealTableQrs();
      setPrintableLabelsModalOpen(true);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao carregar QR Codes.", "danger");
    } finally {
      setBusy("");
    }
  }

  function printSelectedTableQr() {
    const selected = tableQrs[selectedQrTable];
    if (!selected) {
      setFeedback("Selecione uma mesa publicada para imprimir.", "danger");
      return;
    }
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      setFeedback("Permita pop-ups no navegador para imprimir o QR Code.", "danger");
      return;
    }
    printWindow.document.write(
      buildTableQrPrintHtml([selected], {
        displayName: catalog.branding?.restaurantName,
        logoUrl: catalog.branding?.headerBannerUrl,
        primaryColor: catalog.branding?.brandColor,
      }),
    );
    printWindow.document.close();
  }

  const restaurantName = catalog.branding?.restaurantName ?? "";
  const restaurantSlogan = catalog.branding?.slogan ?? "";
  const restaurantLogoUrl = catalog.branding?.headerBannerUrl ?? "";
  const restaurantAddress = catalog.branding?.address ?? "";
  const restaurantPhone = catalog.branding?.phone ?? "";
  const restaurantInstagram = catalog.branding?.instagram ?? "";
  const restaurantOpeningHours = catalog.branding?.openingHours ?? "";
  const brandColor = catalog.branding?.brandColor || "#10b981";
  const serviceTaxNotice = catalog.branding?.serviceTaxNotice ?? "";
  const wifiNotice = catalog.branding?.wifiNotice ?? "";
  const corkageNotice = catalog.branding?.corkageFeeNotice ?? "";

  async function handlePrintMenuPdf() {
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      alert("Por favor, permita popups para gerar a impressão do cardápio.");
      return;
    }

    let publicMenuQrDataUrl = "";
    let publicMenuUrl = "";
    if (pdfShowQr) {
      setBusy("print-menu");
      try {
        const currentPublication = await ensurePublication();
        if (!currentPublication?.url) throw new Error("A publicação não retornou uma URL válida.");
        completeCreateAttempt("catalog-publication");
        setPublication(currentPublication);
        publicMenuUrl = currentPublication.url;
        publicMenuQrDataUrl = await QRCode.toDataURL(currentPublication.url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 320,
        });
      } catch (error) {
        printWindow.close();
        setFeedback(
          error instanceof Error ? error.message : "Falha ao preparar o QR Code do cardápio.",
          "danger",
        );
        setBusy("");
        return;
      }
      setBusy("");
    }

    const categoriesHtml = catalog.categories
      .map((cat) => {
        const catProducts = catalog.products.filter((p) => p.categoryId === cat.id && p.active);
        if (catProducts.length === 0) return "";

        const itemsHtml = catProducts
          .map(
            (prod) => `
          <div class="menu-item">
            <div class="menu-item-header">
              <span class="menu-item-name">${escapeCatalogHtml(prod.name)}</span>
              <span class="menu-item-dots"></span>
              <span class="menu-item-price">${formatMoney(prod.priceCents)}</span>
            </div>
            ${pdfShowDescriptions && prod.description ? `<p class="menu-item-desc">${escapeCatalogHtml(prod.description)}</p>` : ""}
            ${prod.pairingSuggestion ? `<p class="menu-item-pairing">★ Harmonização: ${escapeCatalogHtml(prod.pairingSuggestion)}</p>` : ""}
          </div>
        `,
          )
          .join("");

        return `
        <div class="category-block">
          <h2 class="category-title">— ${escapeCatalogHtml(cat.name.toUpperCase())} —</h2>
          ${cat.description ? `<p class="category-subtitle">${escapeCatalogHtml(cat.description)}</p>` : ""}
          <div class="${pdfLayoutMode === "bistro" ? "items-grid" : "items-list"}">
            ${itemsHtml}
          </div>
        </div>
      `;
      })
      .join("");

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Cardápio - ${restaurantName}</title>
          <style>
            @page {
              size: A4;
              margin: 15mm 15mm 15mm 15mm;
            }
            body {
              font-family: 'Georgia', 'Times New Roman', serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 20px;
              line-height: 1.4;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid ${brandColor};
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            .logo-img {
              max-height: 65px;
              margin-bottom: 8px;
              border-radius: 8px;
            }
            .title {
              font-size: 26pt;
              margin: 0;
              text-transform: uppercase;
              letter-spacing: 2px;
              color: #0f172a;
              font-weight: 700;
            }
            .slogan {
              font-size: 11pt;
              color: #64748b;
              font-style: italic;
              margin: 4px 0 0 0;
              font-family: sans-serif;
            }
            .info-bar {
              font-size: 9pt;
              color: #64748b;
              font-family: sans-serif;
              margin-top: 6px;
            }
            .category-block {
              margin-bottom: 24px;
              break-inside: avoid;
            }
            .category-title {
              font-size: 14pt;
              text-align: center;
              text-transform: uppercase;
              letter-spacing: 1.5px;
              margin: 0 0 2px 0;
              color: #0f172a;
            }
            .category-subtitle {
              text-align: center;
              font-size: 9.5pt;
              color: #64748b;
              font-style: italic;
              font-family: sans-serif;
              margin: 0 0 14px 0;
            }
            .items-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              column-gap: 24px;
              row-gap: 14px;
            }
            .items-list {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            .menu-item {
              break-inside: avoid;
              margin-bottom: 4px;
            }
            .menu-item-header {
              display: flex;
              align-items: baseline;
              justify-content: space-between;
            }
            .menu-item-name {
              font-size: 11pt;
              font-weight: 700;
              color: #0f172a;
            }
            .menu-item-dots {
              flex: 1;
              border-bottom: 1px dotted #94a3b8;
              margin: 0 8px;
            }
            .menu-item-price {
              font-size: 11pt;
              font-weight: 700;
              font-family: sans-serif;
              color: #0f172a;
            }
            .menu-item-desc {
              font-size: 9pt;
              color: #475569;
              font-family: sans-serif;
              margin: 3px 0 0 0;
            }
            .menu-item-pairing {
              font-size: 8.5pt;
              color: #7c3aed;
              font-style: italic;
              font-family: sans-serif;
              margin: 2px 0 0 0;
              font-weight: 600;
            }
            .footer {
              margin-top: 30px;
              padding-top: 14px;
              border-top: 1px solid #cbd5e1;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-family: sans-serif;
              break-inside: avoid;
            }
            .footer-text {
              font-size: 8.5pt;
              color: #64748b;
            }
            .qr-box {
              border: 1px solid #cbd5e1;
              padding: 6px 12px;
              font-size: 8pt;
              font-weight: 700;
              background: #f8fafc;
              border-radius: 4px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .qr-box img {
              display: block;
            }
            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            ${restaurantLogoUrl ? `<img src="${escapeCatalogHtml(restaurantLogoUrl)}" class="logo-img" alt="Logo" />` : ""}
            <h1 class="title">${escapeCatalogHtml(restaurantName)}</h1>
            <p class="slogan">${escapeCatalogHtml(restaurantSlogan)}</p>
            <div class="info-bar">
              ${[restaurantAddress, restaurantPhone, restaurantInstagram]
                .filter(Boolean)
                .map(escapeCatalogHtml)
                .join(" • ")}
            </div>
          </div>

          <div class="content">
            ${categoriesHtml}
          </div>

          <div class="footer">
            <div class="footer-text">
              <strong>${escapeCatalogHtml(restaurantOpeningHours)}</strong><br>
              ${[serviceTaxNotice, wifiNotice, corkageNotice]
                .filter(Boolean)
                .map(escapeCatalogHtml)
                .join(" • ")}
            </div>
            ${
              pdfShowQr
                ? `<div class="qr-box">
                    ${
                      publicMenuQrDataUrl
                        ? `<img src="${publicMenuQrDataUrl}" alt="QR Code do cardápio digital" width="96" height="96" />
                           <span>ACESSE O CARDÁPIO DIGITAL<br><small>${escapeCatalogHtml(publicMenuUrl)}</small></span>`
                        : `<span>CARDÁPIO DIGITAL NO CELULAR</span>`
                    }
                  </div>`
                : ""
            }
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 400);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  }

  // Product Extended Customization Form State (Sizes, Spiciness, Dietary, Pairing)
  const productSizes: ProductSizeVariation[] = [];
  const productSpiciness: SpicinessLevel = "none";
  const productDietaryTags: DietaryTag[] = [];
  const productPairing = "";
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [editingProductPrice, setEditingProductPrice] = useState("");
  const [editingProductDeliveryPrice, setEditingProductDeliveryPrice] = useState("");

  // Multilingual Catalog Preview State
  const [catalogLanguage, setCatalogLanguage] = useState<"pt" | "en" | "es">("pt");

  // CSV Import/Export Modal State
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvParsedPreview, setCsvParsedPreview] = useState<CatalogCsvRow[]>([]);
  const [csvFileName, setCsvFileName] = useState("");

  // QR Codes Generator Modal State
  const [editingProductReason, setEditingProductReason] = useState("");
  const [productType, setProductType] = useState<"prepared" | "resale">("prepared");
  const [eanBarcode, setEanBarcode] = useState("");
  const [currentStockUnits, setCurrentStockUnits] = useState("");
  const autoDeductStock = true;

  // Ficha Técnica & Markup Builder State
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredient[]>([]);
  const [ingName, setIngName] = useState("");
  const [ingQty, setIngQty] = useState("");
  const [ingUnit, setIngUnit] = useState<"g" | "kg" | "ml" | "l" | "un">("g");
  const [ingCost, setIngCost] = useState("");
  const [targetMarkup, setTargetMarkup] = useState<number>(3.0);

  function addIngredient() {
    if (!ingName.trim() || !ingQty || !ingCost) return;
    const costCents = priceToCents(ingCost);
    const qty = parseFloat(ingQty.replace(",", "."));
    if (Number.isNaN(qty) || qty <= 0 || costCents <= 0) return;

    const newIng: RecipeIngredient = {
      id: `ing-${crypto.randomUUID()}`,
      name: ingName.trim(),
      quantity: qty,
      unit: ingUnit,
      costCents: costCents,
    };
    const updated = [...recipeIngredients, newIng];
    setRecipeIngredients(updated);
    setIngName("");
    setIngQty("");
    setIngCost("");

    const totalCostCents = updated.reduce((acc, i) => acc + i.costCents, 0);
    setCost((totalCostCents / 100).toFixed(2).replace(".", ","));
  }

  function removeIngredient(id: string) {
    const updated = recipeIngredients.filter((i) => i.id !== id);
    setRecipeIngredients(updated);
    const totalCostCents = updated.reduce((acc, i) => acc + i.costCents, 0);
    setCost(totalCostCents > 0 ? (totalCostCents / 100).toFixed(2).replace(".", ",") : "");
  }

  function applySuggestedMarkupPrice(totalCostCents: number) {
    const suggestedPrice = Math.round(totalCostCents * targetMarkup);
    setPrice((suggestedPrice / 100).toFixed(2).replace(".", ","));
    setFeedback(
      `Preço sugerido de R$ ${(suggestedPrice / 100).toFixed(2).replace(".", ",")} (Markup ${targetMarkup.toFixed(1)}x) aplicado!`,
    );
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("category");
    setFeedback("");
    try {
      const body = {
        name: categoryName.trim(),
        slug: slugify(categoryName),
        sortOrder: catalog.categories.length,
      };
      await api.pilot.createCategory(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("category", body),
      );
      completeCreateAttempt("category");
      setCategoryName("");
      setFeedback("Categoria criada.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível criar a categoria.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function createStation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("station");
    setFeedback("");
    try {
      const body = {
        name: stationName.trim(),
        code: slugify(stationName).replace(/-/g, "_"),
      };
      await api.pilot.createStation(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("station", body),
      );
      completeCreateAttempt("station");
      setStationName("");
      setFeedback("Estação de produção criada.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível criar a estação de produção.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  function toggleCategoryCollapse(id: string) {
    setCollapsedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function toggleCategoryAvailability(catId: string) {
    const catProducts = catalog.products.filter((p) => p.categoryId === catId);
    const anyAvailable = catProducts.some((p) => p.available);
    const targetAvailable = !anyAvailable;

    setBusy(`toggle-category-${catId}`);
    try {
      await api.pilot.setCategoryAvailability(
        scope.organizationId,
        scope.unitId,
        catId,
        targetAvailable,
      );
      setFeedback(
        targetAvailable
          ? `Todos os ${catProducts.length} itens foram ativados para venda.`
          : `Todos os ${catProducts.length} itens foram pausados temporariamente.`,
      );
      onRetry?.();
      return;
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível atualizar a categoria.",
        "danger",
      );
      return;
    } finally {
      setBusy("");
    }
  }

  function openNewProductForCategory(catId: string) {
    setCategoryId(catId);
    const cat = catalog.categories.find((c) => c.id === catId);
    if (cat?.defaultStationId) {
      setStationIds([cat.defaultStationId]);
    }
    const details = document.getElementById("new-product-details") as HTMLDetailsElement | null;
    if (details) details.open = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openEditCategory(cat: PilotCatalogCategory) {
    setEditingCategory({
      id: cat.id,
      name: cat.name,
      description: cat.description || "",
      salonChannel: cat.channels?.salon ?? true,
      qrMesaChannel: cat.channels?.qrMesa ?? true,
      deliveryChannel: cat.channels?.delivery ?? true,
      hasSchedule: !!cat.schedule,
      startTime: cat.schedule?.startTime || "11:30",
      endTime: cat.schedule?.endTime || "15:00",
      defaultStationId: cat.defaultStationId || "",
    });
  }

  async function updateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCategory) return;
    setBusy("update-category");
    try {
      await api.pilot.updateCategory(scope.organizationId, scope.unitId, editingCategory.id, {
        name: editingCategory.name.trim(),
        description: editingCategory.description.trim() || null,
        channels: [
          ...(editingCategory.salonChannel ? (["salon"] as const) : []),
          ...(editingCategory.qrMesaChannel ? (["qr"] as const) : []),
          ...(editingCategory.deliveryChannel ? (["delivery"] as const) : []),
        ],
        schedule: editingCategory.hasSchedule
          ? {
              windows: Array.from({ length: 7 }, (_, dayOfWeek) => ({
                dayOfWeek,
                start: editingCategory.startTime,
                end: editingCategory.endTime,
              })),
            }
          : null,
        defaultStationId: editingCategory.defaultStationId || null,
      });
      setEditingCategory(null);
      setFeedback("Configurações da categoria salvas.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao atualizar categoria.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  function downloadCsvFile(content: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Exportar Catálogo para CSV
  function exportCatalogToCsv() {
    const restaurant = catalog.branding?.restaurantName?.trim() || "giromesa";
    const filename = `cardapio_${slugify(restaurant) || "giromesa"}.csv`;
    downloadCsvFile(serializeCatalogCsv(catalog), filename);
    setFeedback("Cardápio exportado com sucesso em CSV.");
  }

  // Baixar Modelo CSV em Branco
  function downloadCsvTemplate() {
    downloadCsvFile(catalogCsvTemplate(), "modelo_importacao_cardapio.csv");
  }

  // Importar Itens do CSV para o Catálogo
  function handleCsvFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCatalogCsv(typeof reader.result === "string" ? reader.result : "");
        setCsvParsedPreview(rows);
        setCsvModalOpen(true);
      } catch (error) {
        setCsvParsedPreview([]);
        setFeedback(
          error instanceof Error ? error.message : "Erro ao processar o arquivo CSV.",
          "danger",
        );
      }
    };
    reader.onerror = () => {
      setCsvParsedPreview([]);
      setFeedback("Não foi possível ler o arquivo CSV.", "danger");
    };
    reader.readAsText(file, "utf-8");
  }

  // Confirmar Importação de Itens
  async function commitCsvImport() {
    if (csvParsedPreview.length === 0) return;

    const rows = csvParsedPreview.map((item) => {
      const existing = item.id
        ? catalog.products.find((product) => product.id === item.id)
        : undefined;
      return {
        productId: existing?.id,
        name: item.name,
        categoryName: item.categoryName,
        priceCents: item.priceCents,
        deliveryPriceCents: item.deliveryPriceCents,
        costCents: item.costCents,
        description: item.description ?? undefined,
        estimatedPrepTimeMinutes: item.estimatedPrepTimeMinutes ?? undefined,
        dailyStock: item.dailyStockLimit,
        tags: item.tags,
        stationIds: existing
          ? normalizeCatalogStationIds(existing.stationIds)
          : catalog.stations[0]
            ? [catalog.stations[0].id]
            : [],
        allergenIds: existing?.allergenIds ?? [],
        modifierGroupIds: existing?.modifierGroupIds ?? [],
        recipe:
          existing?.recipe.map((ingredient) => ({
            ingredientName: ingredient.name ?? "Ingrediente",
            quantityMilli: Math.max(1, Math.round(ingredient.quantity * 1_000)),
            unit: ingredient.unit ?? "un",
            lossBasisPoints: 0,
          })) ?? [],
        fiscal: {
          ncm: item.ncm?.replace(/\D/g, "") || undefined,
          cfop: item.cfop?.replace(/\D/g, "") || undefined,
        },
        available: item.available ?? existing?.available ?? true,
      };
    });

    setBusy("csv-import");
    try {
      await api.pilot.importCatalog(
        scope.organizationId,
        scope.unitId,
        { rows, dryRun: false },
        createAttemptKey("csv-import", rows),
      );
      completeCreateAttempt("csv-import");
      setCsvModalOpen(false);
      setCsvParsedPreview([]);
      setCsvFileName("");
      setFeedback(`${rows.length} produto(s) importado(s) com sucesso.`);
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao importar CSV.", "danger");
    } finally {
      setBusy("");
    }
  }

  function duplicateProduct(product: CatalogProduct) {
    setProductName(`${product.name} (Cópia)`);
    setCategoryId(product.categoryId);
    setDescription(product.description || "");
    setImageUrl(product.imageUrl || "");
    setPrice((product.priceCents / 100).toFixed(2).replace(".", ","));
    setDeliveryPrice(
      product.deliveryPriceCents
        ? (product.deliveryPriceCents / 100).toFixed(2).replace(".", ",")
        : "",
    );
    setCost(product.costCents ? (product.costCents / 100).toFixed(2).replace(".", ",") : "");
    setSelectedTags(product.tags || []);
    setSuggestedProducts(product.suggestedProductIds || []);
    setStationIds(normalizeCatalogStationIds(product.stationIds || []));
    setEstimatedPrepTimeMinutes(product.estimatedPrepTimeMinutes ?? "");
    setSelectedAllergens(product.allergenIds || []);
    setSelectedModifiers(product.modifierGroupIds || []);
    const details = document.getElementById("new-product-details") as HTMLDetailsElement | null;
    if (details) details.open = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function applyBulkPriceAdjustment() {
    const val = parseFloat(bulkValue.replace(",", "."));
    if (Number.isNaN(val) || val === 0) return;

    const body = {
      productIds: [],
      categoryIds:
        bulkCategory === "all" ? catalog.categories.map((category) => category.id) : [bulkCategory],
      channel: bulkChannel,
      mode: bulkType,
      value: Math.round(val * 100),
      reason: "Reajuste operacional pelo gerenciamento do cardápio",
    };
    setBusy("bulk-price");
    try {
      await api.pilot.bulkAdjustPrices(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("bulk-price", body),
      );
      completeCreateAttempt("bulk-price");
      setBulkModalOpen(false);
      setFeedback("Reajuste aplicado com sucesso.");
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha no reajuste em lote.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function moveCategory(id: string, direction: "up" | "down") {
    const idx = catalog.categories.findIndex((category) => category.id === id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= catalog.categories.length) return;
    const ordered = [...catalog.categories];
    const current = ordered[idx];
    const target = ordered[targetIdx];
    if (!current || !target) return;
    [ordered[idx], ordered[targetIdx]] = [target, current];

    setBusy("reorder-categories");
    try {
      await api.pilot.reorderCategories(
        scope.organizationId,
        scope.unitId,
        ordered.map((category, sortOrder) => ({ id: category.id, sortOrder })),
      );
      setFeedback("Ordem das categorias atualizada.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao reordenar categorias.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function moveProduct(id: string, direction: "up" | "down") {
    const idx = catalog.products.findIndex((product) => product.id === id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= catalog.products.length) return;
    const ordered = [...catalog.products];
    const current = ordered[idx];
    const target = ordered[targetIdx];
    if (!current || !target) return;
    [ordered[idx], ordered[targetIdx]] = [target, current];

    setBusy("reorder-products");
    try {
      await api.pilot.reorderProducts(
        scope.organizationId,
        scope.unitId,
        ordered.map((product, sortOrder) => ({ id: product.id, sortOrder })),
      );
      setFeedback("Ordem dos produtos atualizada.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao reordenar produtos.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function quickStockOut(productId: string) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (!product) {
      setFeedback("Produto não encontrado. Atualize o cardápio e tente novamente.", "danger");
      return;
    }

    setBusy(`stock-${productId}`);
    try {
      await api.pilot.setProductDailyStock(scope.organizationId, scope.unitId, productId, {
        remaining: 0,
        autoDeductStock: product.autoDeductStock,
      });
      setFeedback("Item marcado como esgotado por hoje.");
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao esgotar item.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function restoreDailyStock(productId: string) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (!product) {
      setFeedback("Produto não encontrado. Atualize o cardápio e tente novamente.", "danger");
      return;
    }

    setBusy(`stock-${productId}`);
    try {
      await api.pilot.setProductDailyStock(scope.organizationId, scope.unitId, productId, {
        remaining: product.dailyStockLimit ?? 20,
        autoDeductStock: product.autoDeductStock,
      });
      setFeedback("Estoque diário reabastecido.");
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao reabastecer item.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function archiveCategory(id: string) {
    if (!window.confirm("Tem certeza que deseja inativar esta categoria?")) return;
    setBusy("archive-category");
    try {
      await api.pilot.archiveCategory(scope.organizationId, scope.unitId, id);
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao inativar categoria.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function updateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;
    if (!hasCatalogProductionStation(editingProduct.stationIds)) {
      setFeedback("Selecione ao menos uma estação de produção.", "danger");
      return;
    }
    setBusy("update-product");
    try {
      const newPriceCents = editingProductPrice.trim()
        ? priceToCents(editingProductPrice)
        : editingProduct.priceCents;
      const newDeliveryCents = editingProductDeliveryPrice.trim()
        ? priceToCents(editingProductDeliveryPrice)
        : null;
      const currentProduct = catalog.products.find((product) => product.id === editingProduct.id);
      if (!currentProduct) throw new Error("Produto não encontrado no catálogo atualizado.");
      await api.pilot.updateProductAggregate(
        scope.organizationId,
        scope.unitId,
        editingProduct.id,
        {
          categoryId: editingProduct.categoryId,
          sku: editingProduct.sku ?? undefined,
          ean: editingProduct.eanBarcode ?? undefined,
          name: editingProduct.name.trim(),
          description: editingProduct.description?.trim() || undefined,
          imageUrl: editingProduct.imageUrl ?? undefined,
          estimatedPrepTimeMinutes: editingProduct.estimatedPrepTimeMinutes ?? undefined,
          productType: editingProduct.productType ?? "prepared",
          priceCents: newPriceCents,
          deliveryPriceCents: newDeliveryCents,
          costCents: editingProduct.costCents ?? null,
          available: currentProduct.available,
          stationIds: normalizeCatalogStationIds(editingProduct.stationIds),
          stationRouting: editingProduct.stationRouting,
          availabilitySchedule: editingProduct.availabilitySchedule ?? null,
          dailyStock: editingProduct.dailyStockLimit ?? null,
          autoDeductStock: editingProduct.autoDeductStock,
          tags: editingProduct.tags,
          suggestedProductIds: editingProduct.suggestedProductIds,
          allergenIds: editingProduct.allergenIds,
          modifierGroupIds: editingProduct.modifierGroupIds,
          recipe: editingProduct.recipe.map((ingredient) => ({
            ingredientName: ingredient.name ?? "Ingrediente",
            quantityMilli: Math.max(1, Math.round(ingredient.quantity * 1_000)),
            unit: ingredient.unit ?? "un",
            lossBasisPoints: 0,
          })),
          sizes: editingProduct.sizes?.map((size, index) => ({
            code: size.id || `size-${index + 1}`,
            name: size.name,
            priceCents: size.priceCents,
          })),
          spiciness:
            editingProduct.spiciness === "hot"
              ? 5
              : editingProduct.spiciness === "medium"
                ? 3
                : editingProduct.spiciness === "mild"
                  ? 1
                  : null,
          dietaryFlags: editingProduct.dietaryTags,
          pairing: editingProduct.pairingSuggestion ?? null,
          fiscal: {
            ncm: editingProduct.ncm?.replace(/\D/g, "") || undefined,
            cfop: editingProduct.cfop?.replace(/\D/g, "") || undefined,
            cest: editingProduct.cest?.replace(/\D/g, "") || undefined,
            origin: editingProduct.fiscalOrigin ?? undefined,
          },
          translations: Object.fromEntries(
            Object.entries(editingProduct.translations ?? {}).flatMap(([locale, translation]) =>
              translation?.name?.trim()
                ? [
                    [
                      locale,
                      {
                        name: translation.name.trim(),
                        description: translation.description?.trim() || undefined,
                      },
                    ],
                  ]
                : [],
            ),
          ),
        },
      );
      setEditingProduct(null);
      setEditingProductPrice("");
      setEditingProductReason("");
      setFeedback("Produto atualizado com sucesso.");
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao atualizar produto.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function archiveProduct(id: string) {
    if (!window.confirm("Tem certeza que deseja inativar este produto?")) return;
    setBusy(`archive-product-${id}`);
    try {
      await api.pilot.archiveProduct(scope.organizationId, scope.unitId, id);
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao inativar produto.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function toggleAvailability(product: CatalogProduct) {
    setBusy(`toggle-${product.id}`);
    try {
      await api.pilot.updateProductUnitConfig(scope.organizationId, scope.unitId, product.id, {
        priceCents: product.priceCents,
        available: !product.available,
        stationIds: normalizeCatalogStationIds(product.stationIds),
        availabilitySchedule: product.availabilitySchedule ?? null,
      });
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao alterar disponibilidade.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeAllergen(id: string) {
    setBusy(`allergen-${id}`);
    try {
      await api.pilot.archiveAllergen(scope.organizationId, scope.unitId, id);
      onRetry?.();

      setFeedback("Alergênico removido.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao remover alergênico.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function removeModifierGroup(id: string) {
    setBusy(`modifier-group-${id}`);
    try {
      await api.pilot.archiveModifierGroup(scope.organizationId, scope.unitId, id);
      onRetry?.();

      setFeedback("Grupo de adicionais removido.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao remover grupo.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function removeModifierOption(id: string) {
    setBusy(`modifier-option-${id}`);
    try {
      await api.pilot.archiveModifierOption(scope.organizationId, scope.unitId, id);
      onRetry?.();

      setFeedback("Opção removida.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao remover opção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function createManagerModifierGroup() {
    const body = {
      name: newGroupName.trim(),
      minimumSelections: newGroupMin,
      maximumSelections: newGroupMax,
      options: [],
    };
    if (body.name.length < 2) return;
    setBusy("manager-modifier-group");
    try {
      await api.pilot.createModifierGroup(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("manager-modifier-group", body),
      );
      completeCreateAttempt("manager-modifier-group");
      onRetry?.();

      setNewGroupName("");
      setNewGroupMin(0);
      setNewGroupMax(1);
      setFeedback(`Grupo "${body.name}" criado com sucesso.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao criar grupo.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function addModifierOption(group: ModifierGroup) {
    const name = newOptionName.trim();
    if (!name) return;
    const priceDeltaCents = priceToCents(newOptionPrice) || 0;
    setBusy(`modifier-option-${group.id}`);
    try {
      const body = {
        name,
        priceDeltaCents,
        active: true,
        sortOrder: catalog.options.filter((option) => option.groupId === group.id).length,
      };
      await api.pilot.createModifierOption(
        scope.organizationId,
        scope.unitId,
        group.id,
        body,
        createAttemptKey(`modifier-option-${group.id}`, body),
      );
      completeCreateAttempt(`modifier-option-${group.id}`);
      onRetry?.();

      setNewOptionName("");
      setNewOptionPrice("");
      setFeedback("Opção adicionada.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao adicionar opção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function createAllergen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy("allergen");
    try {
      const body = {
        name: allergenName.trim(),
        code: allergenCode.trim() || slugify(allergenName),
      };
      await api.pilot.createAllergen(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("allergen", body),
      );
      completeCreateAttempt("allergen");
      setAllergenName("");
      setFeedback("Alergênico cadastrado.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao cadastrar alergênico.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function _createModifierGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const options = (modifierOptionsText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, _i) => {
        const parts = line.split(",");
        return {
          id: crypto.randomUUID(),
          groupId: "temp",
          name: (parts[0] || "").trim(),
          priceDeltaCents: parseInt(parts[1] || "0", 10),
          active: true,
        };
      });

    setBusy("modifier");
    try {
      const body = {
        name: modifierName.trim(),
        minimumSelections: modifierMin,
        maximumSelections: modifierMax,
        options: options.map((option, sortOrder) => ({
          name: option.name,
          priceDeltaCents: option.priceDeltaCents,
          sortOrder,
        })),
      };
      await api.pilot.createModifierGroup(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("modifier", body),
      );
      completeCreateAttempt("modifier");
      setModifierName("");
      setModifierOptionsText("");
      setFeedback("Grupo de adicionais criado.");
      onRetry?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao cadastrar grupo.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedCategory = categoryId || catalog.categories[0]?.id;
    const priceCents = priceToCents(price);
    if (!selectedCategory || priceCents < 0) {
      setFeedback("Crie categoria e estação de produção e informe um preço válido.", "danger");
      return;
    }
    if (!hasCatalogProductionStation(stationIds)) {
      setFeedback("Selecione ao menos uma estação de produção.", "danger");
      return;
    }
    if (Boolean(scheduleStart) !== Boolean(scheduleEnd)) {
      setFeedback("Informe o início e o término do horário de venda.", "danger");
      return;
    }
    setBusy("product");
    setFeedback("");
    try {
      const deliveryPriceCents = deliveryPrice.trim() ? priceToCents(deliveryPrice) : null;
      const costCents = cost.trim() ? priceToCents(cost) : null;
      const stockLimit = dailyStockLimit.trim() ? parseInt(dailyStockLimit, 10) : null;
      const schedule =
        scheduleStart && scheduleEnd
          ? {
              windows: (scheduleDays === "weekdays"
                ? [1, 2, 3, 4, 5]
                : scheduleDays === "weekend"
                  ? [0, 6]
                  : [0, 1, 2, 3, 4, 5, 6]
              ).map((dayOfWeek) => ({
                dayOfWeek,
                start: scheduleStart,
                end: scheduleEnd,
              })),
            }
          : null;

      const persistedImageUrl = imageUrl.startsWith("data:")
        ? await uploadProductImage(
            (imageFileName || "produto.jpg").replace(/\.[^.]+$/, ".jpg"),
            imageUrl,
          )
        : imageUrl.trim();
      if (persistedImageUrl !== imageUrl) {
        setImageUrl(persistedImageUrl);
        setImageFileName("");
      }
      const body = {
        categoryId: selectedCategory,
        ean: eanBarcode.trim() || undefined,
        name: productName.trim(),
        description: description.trim() || undefined,
        imageUrl: persistedImageUrl || undefined,
        stationIds: normalizeCatalogStationIds(stationIds),
        estimatedPrepTimeMinutes:
          productType === "resale" || estimatedPrepTimeMinutes === ""
            ? undefined
            : Number(estimatedPrepTimeMinutes),
        priceCents,
        deliveryPriceCents,
        costCents,
        productType,
        autoDeductStock: productType === "resale" ? autoDeductStock : undefined,
        dailyStock:
          stockLimit ?? (currentStockUnits.trim() ? parseInt(currentStockUnits, 10) : null),
        tags: selectedTags,
        suggestedProductIds: suggestedProducts,
        sizes: productSizes.map((size, index) => ({
          code: size.id || `size-${index + 1}`,
          name: size.name,
          priceCents: size.priceCents,
        })),
        spiciness:
          productSpiciness === "hot"
            ? 5
            : productSpiciness === "medium"
              ? 3
              : productSpiciness === "mild"
                ? 1
                : null,
        dietaryFlags: productDietaryTags,
        pairing: productPairing.trim() || null,
        fiscal: {
          ncm: productNcm.replace(/\D/g, "") || undefined,
          cfop: productCfop.replace(/\D/g, "") || undefined,
          cest: productCest.replace(/\D/g, "") || undefined,
          origin: productOrigin,
        },
        available: true,
        availabilitySchedule: schedule,
        allergenIds: selectedAllergens,
        modifierGroupIds: selectedModifiers,
        recipe: recipeIngredients.map((ingredient) => ({
          ingredientName: ingredient.name,
          quantityMilli: Math.max(1, Math.round(ingredient.quantity * 1_000)),
          unit: ingredient.unit,
          lossBasisPoints: 0,
        })),
      };
      await api.pilot.createProduct(
        scope.organizationId,
        scope.unitId,
        body,
        createAttemptKey("product", body),
      );
      completeCreateAttempt("product");
      setProductName("");
      setDescription("");
      setPrice("");
      setDeliveryPrice("");
      setCost("");
      setImageUrl("");
      setImageFileName("");
      setEanBarcode("");
      setCurrentStockUnits("");
      setProductType("prepared");
      setRecipeIngredients([]);
      setSelectedTags([]);
      setSuggestedProducts([]);
      setScheduleStart("");
      setScheduleEnd("");
      setDailyStockLimit("");
      setSelectedAllergens([]);
      setSelectedModifiers([]);
      setStationIds([]);
      setFeedback("Produto criado e disponibilizado nesta unidade.");
      onRetry?.();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível criar o produto.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  const searchTerm = search.toLowerCase().trim();

  return (
    <div className="growth-stack">
      <CatalogSpreadsheetModal
        busy={busy === "csv-import"}
        catalog={catalog}
        fileName={csvFileName}
        isOpen={csvModalOpen}
        onClear={() => {
          setCsvParsedPreview([]);
          setCsvFileName("");
        }}
        onClose={() => {
          setCsvModalOpen(false);
          setCsvParsedPreview([]);
          setCsvFileName("");
        }}
        onCommit={commitCsvImport}
        onDownloadTemplate={downloadCsvTemplate}
        onExport={exportCatalogToCsv}
        onUpload={handleCsvFileUpload}
        preview={csvParsedPreview}
      />

      <div className="quick-actions-grid">
        <details className="action-panel">
          <summary>
            <span>
              <strong>Nova categoria</strong>
              <small>Organize a leitura do cardápio.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createCategory(event)}>
            <Label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setCategoryName(event.target.value)}
                required
                value={categoryName}
              />
            </Label>
            <Button disabled={busy === "category" || categoryName.trim().length < 2} type="submit">
              {busy === "category" ? "Salvando…" : "Criar categoria"}
            </Button>
          </form>
        </details>
        <details className="action-panel">
          <summary>
            <span>
              <strong>Nova estação de produção</strong>
              <small>Defina onde os itens serão produzidos.</small>
            </span>
            <Icon name="plus" size={18} />
          </summary>
          <form className="action-form" onSubmit={(event) => void createStation(event)}>
            <Label>
              Nome
              <Input
                minLength={2}
                onChange={(event) => setStationName(event.target.value)}
                placeholder="Ex.: Cozinha quente"
                required
                value={stationName}
              />
            </Label>
            <Button disabled={busy === "station" || stationName.trim().length < 2} type="submit">
              {busy === "station" ? "Salvando…" : "Criar estação"}
            </Button>
          </form>
        </details>
      </div>

      <details className="action-panel">
        <summary>
          <span>
            <strong>Novo alergênico</strong>
            <small>Sinalize restrições alimentares (Glúten, Lactose, etc.).</small>
          </span>
          <Icon name="plus" size={18} />
        </summary>
        <form className="action-form" onSubmit={(event) => void createAllergen(event)}>
          <Label>
            Nome do Alergênico
            <Input
              minLength={2}
              onChange={(e) => setAllergenName(e.target.value)}
              required
              value={allergenName}
              placeholder="Ex: Contém Glúten, Lactose, Frutos do Mar"
            />
          </Label>
          <Button disabled={busy === "allergen" || allergenName.trim().length < 2} type="submit">
            {busy === "allergen" ? "Salvando..." : "Criar alergênico"}
          </Button>
        </form>

        {catalog.allergens.length > 0 && (
          <div
            style={{
              padding: "0.85rem 1.15rem 1.15rem",
              borderTop: "1px solid var(--gm-border)",
              background: "var(--gm-surface-sunken, #f8fafc)",
            }}
          >
            <p
              style={{
                fontSize: "0.74rem",
                fontWeight: 700,
                margin: "0 0 8px 0",
                color: "var(--gm-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Alergênicos Cadastrados ({catalog.allergens.length})
            </p>
            <div className="catalog-wrap-6">
              {catalog.allergens.map((alg) => (
                <span
                  key={alg.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    background: "var(--gm-surface)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#dc2626",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <Icon name="alert-circle" size={13} />
                  <span>{alg.name}</span>
                  <Button
                    type="button"
                    disabled={busy === `allergen-${alg.id}`}
                    onClick={() => void removeAllergen(alg.id)}
                    title="Remover alergênico"
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: "#dc2626",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "2px",
                      borderRadius: "4px",
                      marginLeft: "2px",
                    }}
                  >
                    <Icon name="x" size={12} />
                  </Button>
                </span>
              ))}
            </div>
          </div>
        )}
      </details>

      <details className="action-panel">
        <summary>
          <span>
            <strong>Novo adicional (Modificadores)</strong>
            <small>Crie opções extras (Bacon extra, Ponto da carne, etc.).</small>
          </span>
          <Icon name="plus" size={18} />
        </summary>
        <form className="action-form" onSubmit={(event) => void _createModifierGroup(event)}>
          <Label>
            Nome do Grupo
            <Input
              minLength={2}
              onChange={(e) => setModifierName(e.target.value)}
              required
              value={modifierName}
              placeholder="Ex: Ponto da Carne, Adicionais do Hambúrguer"
            />
          </Label>
          <div style={{ display: "flex", gap: "8px" }}>
            <Label className="catalog-grow">
              Mínimo
              <Input
                type="number"
                min={0}
                value={modifierMin}
                onChange={(e) => setModifierMin(parseInt(e.target.value, 10) || 0)}
              />
            </Label>
            <Label className="catalog-grow">
              Máximo
              <Input
                type="number"
                min={1}
                value={modifierMax}
                onChange={(e) => setModifierMax(parseInt(e.target.value, 10) || 1)}
              />
            </Label>
          </div>
          <Label className="action-form__wide">
            Opções (Nome, Preço em centavos - uma por linha)
            <Textarea
              rows={3}
              onChange={(e) => setModifierOptionsText(e.target.value)}
              value={modifierOptionsText}
              placeholder="Bacon Extra, 400&#10;Queijo Cheddar, 350&#10;Molho Especial, 0"
            />
          </Label>
          <Button disabled={busy === "modifier" || modifierName.trim().length < 2} type="submit">
            {busy === "modifier" ? "Salvando..." : "Criar grupo de adicionais"}
          </Button>
        </form>

        {catalog.groups.length > 0 && (
          <div
            style={{
              padding: "0.85rem 1.15rem 1.15rem",
              borderTop: "1px solid var(--gm-border)",
              background: "var(--gm-surface-sunken, #f8fafc)",
            }}
          >
            <p
              style={{
                fontSize: "0.74rem",
                fontWeight: 700,
                margin: "0 0 8px 0",
                color: "var(--gm-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Grupos de Adicionais Cadastrados ({catalog.groups.length})
            </p>
            <div className="catalog-wrap-6">
              {catalog.groups.map((grp) => (
                <span
                  key={grp.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    background: "var(--gm-surface)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    color: "#059669",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <Icon name="plus" size={13} />
                  <span>
                    {grp.name} ({grp.minimumSelections}-{grp.maximumSelections})
                  </span>
                  <Button
                    type="button"
                    disabled={busy === `modifier-group-${grp.id}`}
                    onClick={() => void removeModifierGroup(grp.id)}
                    title="Remover grupo"
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: "#059669",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "2px",
                      borderRadius: "4px",
                      marginLeft: "2px",
                    }}
                  >
                    <Icon name="x" size={12} />
                  </Button>
                </span>
              ))}
            </div>
          </div>
        )}
      </details>

      <details className="action-panel" id="new-product-details">
        <summary>
          <span>
            <strong>Novo produto</strong>
            <small>Cadastre preço e destino de produção.</small>
          </span>
          <Icon name="plus" size={18} />
        </summary>
        <form className="action-form" onSubmit={(event) => void createProduct(event)}>
          <div className="action-form__wide catalog-product-type">
            <Button
              className="catalog-product-type__option"
              data-selected={productType === "prepared" || undefined}
              type="button"
              onClick={() => setProductType("prepared")}
            >
              <Icon name="salon" size={14} />
              <span>Produto Preparado / Cozinha</span>
            </Button>
            <Button
              className="catalog-product-type__option"
              data-selected={productType === "resale" || undefined}
              type="button"
              onClick={() => setProductType("resale")}
            >
              <Icon name="catalog" size={14} />
              <span>Produto de Revenda (Bebidas / Estoque Direto)</span>
            </Button>
          </div>

          <Label>
            Nome do Produto
            <Input
              minLength={2}
              onChange={(event) => setProductName(event.target.value)}
              required
              placeholder={
                productType === "resale"
                  ? "Ex: Heineken Long Neck 330ml"
                  : "Ex: Risoto de Cogumelos"
              }
              value={productName}
            />
          </Label>

          {productType === "resale" && (
            <>
              <Label>
                Código de Barras / EAN
                <Input
                  value={eanBarcode}
                  onChange={(e) => setEanBarcode(e.target.value)}
                  placeholder="Ex: 7896045506216"
                />
              </Label>
              <Label>
                Estoque Físico Atual (Unidades)
                <Input
                  type="number"
                  min="0"
                  value={currentStockUnits}
                  onChange={(e) => setCurrentStockUnits(e.target.value)}
                  placeholder="Ex: 48"
                />
              </Label>
            </>
          )}

          <Label>
            Preço Salão (R$)
            <Input
              inputMode="decimal"
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0,00"
              required
              value={price}
            />
          </Label>
          <Label>
            Preço Delivery (Opcional)
            <Input
              inputMode="decimal"
              onChange={(event) => setDeliveryPrice(event.target.value)}
              placeholder="Ex: 35,00"
              value={deliveryPrice}
            />
          </Label>
          <Label>
            {productType === "resale"
              ? "Custo de Compra Unitário (R$)"
              : "Custo Unitário / Insumos (R$)"}
            <Input
              inputMode="decimal"
              onChange={(event) => setCost(event.target.value)}
              placeholder="Ex: 8,50"
              value={cost}
            />
          </Label>
          <Label>
            Categoria
            <NativeSelect
              onChange={(event) => setCategoryId(event.target.value)}
              required
              value={categoryId || catalog.categories[0]?.id || ""}
            >
              <option disabled value="">
                Crie uma categoria
              </option>
              {catalog.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </Label>

          {/* Estações de produção */}
          <div className="action-form__wide catalog-create-stations">
            <span className="catalog-text-strong-078">Estações de produção</span>
            <small className="catalog-create-stations__help">
              Cada estação selecionada recebe o item e todas precisam concluir. Selecione ao menos
              uma.
            </small>
            <div className="catalog-create-stations__options">
              {catalog.stations.map((item) => {
                const selected = stationIds.includes(item.id);
                return (
                  <Button
                    className="catalog-create-station"
                    data-selected={selected || undefined}
                    key={item.id}
                    aria-pressed={selected}
                    type="button"
                    onClick={() =>
                      setStationIds((current) => toggleCatalogStationId(current, item.id))
                    }
                  >
                    <span className="catalog-create-station__dot" />
                    {item.name}
                  </Button>
                );
              })}
            </div>
          </div>

          <Label className="action-form__wide">
            Descrição do Prato / Item
            <Textarea
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="Descreva os ingredientes principais, sabor e apresentação do prato..."
              value={description}
            />
          </Label>

          <Label className="action-form__wide">
            Foto do Prato (Opcional)
            <input
              className="border-input bg-background"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) {
                  setFeedback("Use uma imagem JPG, PNG ou WEBP.", "danger");
                  event.target.value = "";
                  return;
                }
                if (file.size > 5 * 1024 * 1024) {
                  setFeedback("A foto do produto deve ter no máximo 5 MB.", "danger");
                  event.target.value = "";
                  return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                  const img = new Image();
                  img.onload = () => {
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
                      setImageUrl(canvas.toDataURL("image/jpeg", 0.7));
                      setImageFileName(file.name);
                    }
                  };
                  img.src = e.target?.result as string;
                };
                reader.onerror = () => setFeedback("Não foi possível ler a imagem.", "danger");
                reader.readAsDataURL(file);
              }}
            />
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Preview"
                style={{
                  marginTop: "8px",
                  maxHeight: "100px",
                  borderRadius: "6px",
                  objectFit: "cover",
                }}
              />
            )}
          </Label>

          {/* Sub-grupos Recolhíveis de Configuração */}
          <div
            className="action-form__wide"
            style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}
          >
            {/* Sub-Accordion 1: Ficha Técnica (Apenas para produtos preparados) */}
            {productType === "prepared" && (
              <details className="catalog-sub-accordion" open={recipeIngredients.length > 0}>
                <summary>
                  <div className="catalog-inline-center-8">
                    <Icon name="finance" size={15} />
                    <span>Ficha Técnica Gastronômica & Simulador de Markup</span>
                  </div>
                  {recipeIngredients.length > 0 && (
                    <span
                      style={{
                        fontSize: "0.74rem",
                        color: "var(--gm-brand)",
                        fontWeight: 700,
                      }}
                    >
                      {recipeIngredients.length} insumo(s) • CMV{" "}
                      {formatMoney(recipeIngredients.reduce((a, b) => a + b.costCents, 0))}
                    </span>
                  )}
                </summary>
                <div className="catalog-sub-accordion__content">
                  {recipeIngredients.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {recipeIngredients.map((ing) => (
                        <div
                          key={ing.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "var(--gm-surface)",
                            padding: "6px 10px",
                            borderRadius: "6px",
                            border: "1px solid var(--gm-border)",
                            fontSize: "0.8rem",
                          }}
                        >
                          <div className="catalog-inline-center-8">
                            <span style={{ fontWeight: 650, color: "var(--gm-ink)" }}>
                              {ing.name}
                            </span>
                            <span style={{ color: "var(--gm-muted)", fontSize: "0.74rem" }}>
                              {ing.quantity} {ing.unit}
                            </span>
                          </div>
                          <div className="catalog-inline-center-10">
                            <strong className="catalog-ink">{formatMoney(ing.costCents)}</strong>
                            <Button
                              type="button"
                              className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                              style={{ width: "24px", height: "24px" }}
                              onClick={() => removeIngredient(ing.id)}
                              title="Remover insumo"
                            >
                              <Icon name="x" size={11} />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 1fr 1.2fr auto",
                      gap: "6px",
                      alignItems: "center",
                    }}
                  >
                    <Input
                      placeholder="Insumo (ex: Filé Mignon)"
                      value={ingName}
                      onChange={(e) => setIngName(e.target.value)}
                      className="catalog-input-compact"
                    />
                    <Input
                      type="number"
                      min="0.1"
                      step="any"
                      placeholder="Qtd (200)"
                      value={ingQty}
                      onChange={(e) => setIngQty(e.target.value)}
                      className="catalog-input-compact"
                    />
                    <NativeSelect
                      value={ingUnit}
                      onChange={(e) => setIngUnit(e.target.value as typeof ingUnit)}
                      style={{
                        padding: "5px 6px",
                        fontSize: "0.78rem",
                        borderRadius: "6px",
                        border: "1px solid var(--gm-border)",
                        background: "var(--gm-surface)",
                        color: "var(--gm-ink)",
                      }}
                    >
                      <option value="g">g</option>
                      <option value="kg">kg</option>
                      <option value="ml">ml</option>
                      <option value="l">L</option>
                      <option value="un">un</option>
                    </NativeSelect>
                    <Input
                      placeholder="Custo R$ (9,50)"
                      value={ingCost}
                      onChange={(e) => setIngCost(e.target.value)}
                      className="catalog-input-compact"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      style={{ padding: "0 10px", height: "30px", fontSize: "0.76rem" }}
                      onClick={addIngredient}
                      disabled={!ingName.trim() || !ingQty || !ingCost}
                    >
                      <Icon name="plus" size={12} />
                      <span>Adicionar</span>
                    </Button>
                  </div>

                  {recipeIngredients.length > 0 &&
                    (() => {
                      const totalCostCents = recipeIngredients.reduce((a, b) => a + b.costCents, 0);
                      const suggestedPriceCents = Math.round(totalCostCents * targetMarkup);
                      return (
                        <div
                          style={{
                            background: "rgba(37, 99, 235, 0.05)",
                            border: "1px dashed rgba(37, 99, 235, 0.3)",
                            borderRadius: "6px",
                            padding: "8px 12px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: "8px",
                            fontSize: "0.8rem",
                          }}
                        >
                          <div className="catalog-inline-center-8">
                            <span className="catalog-ink">Markup Alvo:</span>
                            <div className="catalog-inline-4">
                              {[2.5, 3.0, 3.5, 4.0].map((m) => (
                                <Button
                                  key={m}
                                  type="button"
                                  onClick={() => setTargetMarkup(m)}
                                  style={{
                                    padding: "2px 8px",
                                    borderRadius: "4px",
                                    fontSize: "0.74rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    border:
                                      targetMarkup === m
                                        ? "1px solid var(--gm-brand)"
                                        : "1px solid var(--gm-border)",
                                    background:
                                      targetMarkup === m ? "var(--gm-brand)" : "var(--gm-surface)",
                                    color: targetMarkup === m ? "#fff" : "var(--gm-ink)",
                                  }}
                                >
                                  {m.toFixed(1)}x
                                </Button>
                              ))}
                            </div>
                          </div>

                          <div className="catalog-inline-center-10">
                            <span>
                              Sugerido:{" "}
                              <strong style={{ color: "var(--gm-brand)" }}>
                                {formatMoney(suggestedPriceCents)}
                              </strong>
                            </span>
                            <Button
                              type="button"
                              className="catalog-card-btn catalog-card-btn--active"
                              style={{ height: "26px", fontSize: "0.74rem" }}
                              onClick={() => applySuggestedMarkupPrice(totalCostCents)}
                            >
                              <Icon name="check" size={12} />
                              <span>Usar no Preço</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                </div>
              </details>
            )}

            {/* Sub-Accordion 2: Horários, Tempo de Preparo & Esgotamento */}
            <details className="catalog-sub-accordion">
              <summary>
                <div className="catalog-inline-center-8">
                  <Icon name="clock" size={15} />
                  <span>Horários de Venda, Tempo de Preparo & Esgotamento</span>
                </div>
                {(estimatedPrepTimeMinutes || dailyStockLimit || scheduleStart) && (
                  <span style={{ fontSize: "0.74rem", color: "var(--gm-brand)", fontWeight: 700 }}>
                    Configurado
                  </span>
                )}
              </summary>
              <div className="catalog-sub-accordion__content">
                <div className="catalog-grid-2">
                  <Label style={{ margin: 0 }}>
                    Tempo de Preparo Estimado (min)
                    <Input
                      type="number"
                      min="0"
                      onChange={(event) =>
                        setEstimatedPrepTimeMinutes(
                          event.target.value === "" ? "" : parseInt(event.target.value, 10),
                        )
                      }
                      value={estimatedPrepTimeMinutes}
                      placeholder="Ex: 15"
                    />
                  </Label>
                  <Label style={{ margin: 0 }}>
                    Limite Diário de Porções (Opcional)
                    <Input
                      type="number"
                      min="1"
                      onChange={(event) => setDailyStockLimit(event.target.value)}
                      value={dailyStockLimit}
                      placeholder="Ex: 25 porções/dia"
                    />
                  </Label>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    marginTop: "4px",
                  }}
                >
                  <span className="catalog-text-strong-078">
                    Agendamento de Disponibilidade por Horário (Opcional)
                  </span>
                  <div className="catalog-schedule-grid">
                    <Label className="catalog-small-copy">
                      Início
                      <Input
                        type="time"
                        value={scheduleStart}
                        onChange={(e) => setScheduleStart(e.target.value)}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "6px",
                          border: "1px solid var(--gm-border)",
                        }}
                      />
                    </Label>
                    <Label className="catalog-small-copy">
                      Término
                      <Input
                        type="time"
                        value={scheduleEnd}
                        onChange={(e) => setScheduleEnd(e.target.value)}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "6px",
                          border: "1px solid var(--gm-border)",
                        }}
                      />
                    </Label>
                    <Label className="catalog-small-copy">
                      Dias
                      <NativeSelect
                        value={scheduleDays}
                        onChange={(e) => setScheduleDays(e.target.value as typeof scheduleDays)}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "6px",
                          border: "1px solid var(--gm-border)",
                          background: "var(--gm-surface)",
                          color: "var(--gm-ink)",
                        }}
                      >
                        <option value="all">Todos os Dias</option>
                        <option value="weekdays">Segunda a Sexta</option>
                        <option value="weekend">Fim de Semana</option>
                      </NativeSelect>
                    </Label>
                  </div>
                </div>
              </div>
            </details>

            {/* Sub-Accordion 3: Alérgenos & Restrições Alimentares */}
            {catalog.allergens.length > 0 && (
              <details className="catalog-sub-accordion">
                <summary>
                  <div className="catalog-inline-center-8">
                    <Icon name="alert-circle" size={15} />
                    <span>Alérgenos & Restrições Alimentares</span>
                  </div>
                  {selectedAllergens.length > 0 && (
                    <span style={{ fontSize: "0.74rem", color: "#dc2626", fontWeight: 700 }}>
                      {selectedAllergens.length} marcado(s)
                    </span>
                  )}
                </summary>
                <div className="catalog-sub-accordion__content">
                  <div className="gm-toolbar">
                    {catalog.allergens.map((alg) => {
                      const selected = selectedAllergens.includes(alg.id);
                      return (
                        <Button
                          key={alg.id}
                          type="button"
                          onClick={() => {
                            if (selected)
                              setSelectedAllergens(selectedAllergens.filter((id) => id !== alg.id));
                            else setSelectedAllergens([...selectedAllergens, alg.id]);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "5px 12px",
                            borderRadius: "9999px",
                            fontSize: "0.82rem",
                            fontWeight: selected ? 650 : 500,
                            cursor: "pointer",
                            border: selected ? "1.5px solid #ef4444" : "1px solid var(--gm-border)",
                            background: selected ? "rgba(239, 68, 68, 0.1)" : "var(--gm-surface)",
                            color: selected ? "#dc2626" : "var(--gm-ink)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <Icon name="alert-circle" size={13} />
                          <span>{alg.name}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}

            {/* Sub-Accordion 4: Grupos de Modificadores & Adicionais */}
            {catalog.groups.length > 0 && (
              <details className="catalog-sub-accordion">
                <summary>
                  <div className="catalog-inline-center-8">
                    <Icon name="plus" size={15} />
                    <span>Grupos de Adicionais & Modificadores</span>
                  </div>
                  {selectedModifiers.length > 0 && (
                    <span className="catalog-text-positive">
                      {selectedModifiers.length} grupo(s)
                    </span>
                  )}
                </summary>
                <div className="catalog-sub-accordion__content">
                  <div className="gm-toolbar">
                    {catalog.groups.map((grp) => {
                      const selected = selectedModifiers.includes(grp.id);
                      return (
                        <Button
                          key={grp.id}
                          type="button"
                          onClick={() => {
                            if (selected)
                              setSelectedModifiers(selectedModifiers.filter((id) => id !== grp.id));
                            else setSelectedModifiers([...selectedModifiers, grp.id]);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "5px 12px",
                            borderRadius: "9999px",
                            fontSize: "0.82rem",
                            fontWeight: selected ? 650 : 500,
                            cursor: "pointer",
                            border: selected ? "1.5px solid #10b981" : "1px solid var(--gm-border)",
                            background: selected ? "rgba(16, 185, 129, 0.1)" : "var(--gm-surface)",
                            color: selected ? "#059669" : "var(--gm-ink)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <Icon name="plus" size={13} />
                          <span>{grp.name}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </details>
            )}

            {/* Sub-Accordion: Dados Fiscais para Cupom & NFC-e */}
            <details className="catalog-sub-accordion">
              <summary>
                <div className="catalog-inline-center-8">
                  <Icon name="finance" size={15} />
                  <span>Dados Fiscais para NFC-e / SAT (Opcional)</span>
                </div>
                {productNcm && <span className="catalog-text-positive">NCM: {productNcm}</span>}
              </summary>
              <div className="catalog-sub-accordion__content">
                <div className="catalog-grid-main">
                  <Label className="gm-field catalog-field--compact">
                    NCM (Nomenclatura Comum do Mercosul)
                    <Input
                      value={productNcm}
                      onChange={(e) => setProductNcm(e.target.value)}
                      placeholder="Ex: 2106.90.90"
                      className="catalog-control-34"
                    />
                  </Label>
                  <Label className="gm-field catalog-field--compact">
                    CFOP Padrão
                    <NativeSelect
                      value={productCfop}
                      onChange={(e) => setProductCfop(e.target.value)}
                      className="catalog-control-34"
                    >
                      <option value="5.102">5.102 - Revenda de Mercadoria</option>
                      <option value="5.101">5.101 - Produção do Estabelecimento</option>
                      <option value="5.405">5.405 - Venda com Subst. Tributária</option>
                    </NativeSelect>
                  </Label>
                </div>

                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
                  <span className="catalog-muted-072">Atalhos Rápidos de NCM:</span>
                  {[
                    { label: "Pratos & Lanches (2106.90.90)", code: "2106.90.90" },
                    { label: "Chopes & Cervejas (2203.00.00)", code: "2203.00.00" },
                    { label: "Refrigerantes & Sucos (2202.10.00)", code: "2202.10.00" },
                    { label: "Sobremesas & Doces (1905.90.90)", code: "1905.90.90" },
                  ].map((preset) => (
                    <Button
                      key={preset.code}
                      type="button"
                      onClick={() => setProductNcm(preset.code)}
                      style={{
                        fontSize: "0.7rem",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        border: "1px solid var(--gm-border)",
                        background: "var(--gm-surface)",
                        color: "var(--gm-ink)",
                        cursor: "pointer",
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            </details>

            {/* Sub-Accordion 5: Selos Promocionais & Venda Sugerida */}
            <details className="catalog-sub-accordion">
              <summary>
                <div className="catalog-inline-center-8">
                  <Icon name="catalog" size={15} />
                  <span>Selos Promocionais & Venda Sugerida (Cross-Sell)</span>
                </div>
                {(selectedTags.length > 0 || suggestedProducts.length > 0) && (
                  <span style={{ fontSize: "0.74rem", color: "var(--gm-brand)", fontWeight: 700 }}>
                    {selectedTags.length + suggestedProducts.length} ativo(s)
                  </span>
                )}
              </summary>
              <div className="catalog-sub-accordion__content">
                <div className="catalog-stack catalog-stack--6">
                  <span className="catalog-text-strong-078">Destaques e Selos de Venda</span>
                  <div className="gm-toolbar">
                    {[
                      {
                        id: "chef_special" as const,
                        label: "Recomendação do Chef",
                        icon: "check" as const,
                        color: "#8b5cf6",
                      },
                      {
                        id: "bestseller" as const,
                        label: "Mais Vendido",
                        icon: "alerts" as const,
                        color: "#f59e0b",
                      },
                      {
                        id: "new" as const,
                        label: "Novidade",
                        icon: "plus" as const,
                        color: "#3b82f6",
                      },
                      {
                        id: "promo" as const,
                        label: "Promoção",
                        icon: "finance" as const,
                        color: "#ec4899",
                      },
                    ].map((tag) => {
                      const selected = selectedTags.includes(tag.id);
                      return (
                        <Button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            if (selected) setSelectedTags(selectedTags.filter((t) => t !== tag.id));
                            else setSelectedTags([...selectedTags, tag.id]);
                          }}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "5px 12px",
                            borderRadius: "9999px",
                            fontSize: "0.82rem",
                            fontWeight: selected ? 650 : 500,
                            cursor: "pointer",
                            border: selected
                              ? `1.5px solid ${tag.color}`
                              : "1px solid var(--gm-border)",
                            background: selected ? `${tag.color}18` : "var(--gm-surface)",
                            color: selected ? tag.color : "var(--gm-ink)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <Icon name={tag.icon} size={13} />
                          <span>{tag.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {catalog.products.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      marginTop: "6px",
                    }}
                  >
                    <span className="catalog-text-strong-078">
                      Harmonização & Acompanhamentos Sugeridos
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {catalog.products.slice(0, 10).map((prod) => {
                        const selected = suggestedProducts.includes(prod.id);
                        return (
                          <Button
                            key={prod.id}
                            type="button"
                            onClick={() => {
                              if (selected)
                                setSuggestedProducts(
                                  suggestedProducts.filter((id) => id !== prod.id),
                                );
                              else setSuggestedProducts([...suggestedProducts, prod.id]);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "4px 10px",
                              borderRadius: "6px",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              border: selected
                                ? "1.5px solid var(--gm-brand, #2563eb)"
                                : "1px solid var(--gm-border)",
                              background: selected
                                ? "rgba(37, 99, 235, 0.08)"
                                : "var(--gm-surface)",
                              color: selected ? "var(--gm-brand, #2563eb)" : "var(--gm-ink)",
                              transition: "all 0.15s ease",
                            }}
                          >
                            <Icon name={selected ? "check" : "plus"} size={11} />
                            <span>{prod.name}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </details>
          </div>

          <Button
            disabled={
              busy === "product" ||
              productName.trim().length < 2 ||
              catalog.categories.length === 0 ||
              catalog.stations.length === 0 ||
              stationIds.length === 0
            }
            type="submit"
          >
            {busy === "product" ? "Salvando…" : "Criar produto"}
          </Button>
        </form>
      </details>

      {feedback && (
        <Toast
          message={feedback}
          tone={feedbackTone}
          title={feedbackTone === "danger" ? "Não foi possível concluir" : "Cardápio"}
          onDismiss={() => setFeedback("")}
        />
      )}

      {/* Header com Título e Ações Principais */}
      <CatalogManagementHeader
        brandingHref="#/settings?section=brand"
        categoryCount={catalog.categories.length}
        comboCount={catalog.combos.length}
        groupCount={catalog.groups.length}
        language={catalogLanguage}
        onExportCsv={exportCatalogToCsv}
        onImportCsv={handleCsvFileUpload}
        onLanguageChange={setCatalogLanguage}
        onOpenBulkAdjustment={() => setBulkModalOpen(true)}
        onOpenCustomerPreview={() => void openCustomerPreview()}
        onOpenLabels={() => void openPrintableLabels()}
        onOpenMatrix={() => void openBcgMatrix()}
        onOpenModifiers={() => setModifiersManagerModalOpen(true)}
        onOpenPdf={() => setPdfExportModalOpen(true)}
        onOpenPromotions={() => setPromosAndCombosModalOpen(true)}
        tableQrHref={routeHref("table-qrs")}
        onOpenReorder={() => setReorderModalOpen(true)}
        onOpenSpreadsheet={() => setCsvModalOpen(true)}
        productCount={catalog.products.length}
        production
      />

      {/* Barra Integrada de Controle e Filtros */}
      <CatalogFilters
        categories={catalog.categories}
        dietFilter={selectedAllergenFilter}
        onCategoryChange={setSelectedTabCategoryId}
        onDietFilterChange={setSelectedAllergenFilter}
        onSearchChange={setSearch}
        onStatusChange={setFilterStatus}
        onViewModeChange={setViewMode}
        products={catalog.products}
        production
        search={search}
        selectedCategoryId={selectedTabCategoryId}
        status={filterStatus}
        viewMode={viewMode}
      />

      {bulkModalOpen && (
        <Modal
          isOpen={bulkModalOpen}
          title="Reajuste de Preços em Lote"
          onClose={() => setBulkModalOpen(false)}
        >
          <div className="catalog-stack catalog-stack--16">
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--gm-muted)" }}>
              Aplique um reajuste percentual ou valor fixo em múltiplos pratos de uma só vez.
            </p>

            <Label className="gm-field catalog-field--medium">
              Categoria Alvo
              <NativeSelect
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                className="catalog-control-padded"
              >
                <option value="all">Todas as Categorias ({catalog.products.length} itens)</option>
                {catalog.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({catalog.products.filter((p) => p.categoryId === c.id).length} itens)
                  </option>
                ))}
              </NativeSelect>
            </Label>

            <Label className="gm-field catalog-field--medium">
              Canal de Venda
              <NativeSelect
                value={bulkChannel}
                onChange={(e) => setBulkChannel(e.target.value as typeof bulkChannel)}
                className="catalog-control-padded"
              >
                <option value="both">Salão e Delivery</option>
                <option value="salon">Apenas Preço do Salão</option>
                <option value="delivery">Apenas Preço do Delivery</option>
              </NativeSelect>
            </Label>

            <div className="catalog-grid-2">
              <Label className="gm-field catalog-field--medium">
                Tipo de Ajuste
                <NativeSelect
                  value={bulkType}
                  onChange={(e) => setBulkType(e.target.value as typeof bulkType)}
                  className="catalog-control-padded"
                >
                  <option value="percentage">Percentual (%)</option>
                  <option value="fixed">Definir preço final (R$)</option>
                </NativeSelect>
              </Label>

              <Label className="gm-field catalog-field--medium">
                Valor do Ajuste
                <Input
                  type="number"
                  step="any"
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  placeholder={bulkType === "percentage" ? "Ex: 10 para +10%" : "Ex: 2.50"}
                  className="catalog-control-padded"
                />
              </Label>
            </div>

            <div
              style={{
                padding: "10px 14px",
                borderRadius: "6px",
                background: "var(--gm-surface-sunken)",
                fontSize: "0.82rem",
                color: "var(--gm-ink)",
              }}
            >
              Impacto:{" "}
              <strong>
                {bulkCategory === "all"
                  ? catalog.products.length
                  : catalog.products.filter((p) => p.categoryId === bulkCategory).length}{" "}
                produto(s)
              </strong>{" "}
              serão reajustados.
            </div>

            <div className="catalog-modal-actions">
              <Button variant="ghost" onClick={() => setBulkModalOpen(false)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={applyBulkPriceAdjustment}>
                Aplicar Reajuste
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <CatalogProductsPanel
        archiveCategory={archiveCategory}
        archiveProduct={archiveProduct}
        busy={busy}
        catalog={catalog}
        catalogLanguage={catalogLanguage}
        collapsedCategories={collapsedCategories}
        duplicateProduct={duplicateProduct}
        filterStatus={filterStatus}
        moveCategory={moveCategory}
        moveProduct={moveProduct}
        openEditCategory={openEditCategory}
        openNewProductForCategory={openNewProductForCategory}
        production
        quickStockOut={quickStockOut}
        restoreDailyStock={restoreDailyStock}
        searchTerm={searchTerm}
        selectedAllergenFilter={selectedAllergenFilter}
        selectedTabCategoryId={selectedTabCategoryId}
        setCustomizerSelections={setCustomizerSelections}
        setEditingProduct={setEditingProduct}
        setEditingProductDeliveryPrice={setEditingProductDeliveryPrice}
        setEditingProductPrice={setEditingProductPrice}
        setEditingProductReason={setEditingProductReason}
        setModifierCustomizerProduct={setModifierCustomizerProduct}
        toggleAvailability={toggleAvailability}
        toggleCategoryAvailability={toggleCategoryAvailability}
        toggleCategoryCollapse={toggleCategoryCollapse}
        updateProductInlineDeliveryPrice={updateProductInlineDeliveryPrice}
        updateProductInlinePrice={updateProductInlinePrice}
        viewMode={viewMode}
      />

      {/* Modal de Configurações de Categoria */}
      {editingCategory && (
        <Modal
          isOpen={editingCategory !== null}
          onClose={() => setEditingCategory(null)}
          title={`Configurações da Categoria: ${editingCategory.name}`}
          size="md"
        >
          <form onSubmit={(event) => void updateCategory(event)} className="gm-form-stack">
            {/* Nome da Categoria */}
            <Label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "0.84rem",
                fontWeight: 700,
                color: "var(--gm-ink)",
              }}
            >
              Nome da Categoria *
              <Input
                minLength={2}
                onChange={(event) =>
                  setEditingCategory({ ...editingCategory, name: event.target.value })
                }
                required
                value={editingCategory.name}
                placeholder="Ex: Entradas, Hambúrgueres Artesanais, Sobremesas..."
                style={{
                  width: "100%",
                  height: "42px",
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--gm-border)",
                  background: "var(--gm-surface)",
                  color: "var(--gm-ink)",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  boxSizing: "border-box",
                }}
              />
            </Label>

            {
              <>
                {/* Subtítulo / Descrição da Categoria */}
                <Label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    fontSize: "0.84rem",
                    fontWeight: 700,
                    color: "var(--gm-ink)",
                  }}
                >
                  Subtítulo / Descrição da Categoria
                  <Textarea
                    rows={2}
                    onChange={(event) =>
                      setEditingCategory({
                        ...editingCategory,
                        description: event.target.value,
                      })
                    }
                    value={editingCategory.description}
                    placeholder="Ex: Ideais para compartilhar • Servidas quentes com molho artesanal da casa..."
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface)",
                      color: "var(--gm-ink)",
                      fontSize: "0.85rem",
                      lineHeight: 1.4,
                      resize: "vertical",
                      boxSizing: "border-box",
                    }}
                  />
                  <span style={{ fontSize: "0.74rem", color: "var(--gm-muted)", fontWeight: 400 }}>
                    Texto exibido abaixo do título da categoria no cardápio digital do cliente.
                  </span>
                </Label>

                {/* Canais de Venda da Categoria */}
                <div className="catalog-stack catalog-stack--8">
                  <div>
                    <strong
                      style={{
                        fontSize: "0.84rem",
                        color: "var(--gm-ink)",
                        display: "block",
                      }}
                    >
                      Canais de Exibição & Venda
                    </strong>
                    <span style={{ fontSize: "0.74rem", color: "var(--gm-muted)" }}>
                      Clique nos canais para ativar ou desativar esta categoria
                    </span>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "10px",
                      width: "100%",
                    }}
                  >
                    <Button
                      type="button"
                      onClick={() =>
                        setEditingCategory({
                          ...editingCategory,
                          salonChannel: !editingCategory.salonChannel,
                        })
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        padding: "12px 8px",
                        borderRadius: "8px",
                        border: editingCategory.salonChannel
                          ? "1.5px solid var(--gm-brand)"
                          : "1px solid var(--gm-border)",
                        background: editingCategory.salonChannel
                          ? "rgba(16, 185, 129, 0.08)"
                          : "var(--gm-surface-soft)",
                        color: "var(--gm-ink)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    >
                      <Icon name="salon" size={20} />
                      <strong style={{ fontSize: "0.8rem", textAlign: "center" }}>
                        Salão & Balcão
                      </strong>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: editingCategory.salonChannel ? "#10b981" : "var(--gm-muted)",
                          fontWeight: 700,
                        }}
                      >
                        {editingCategory.salonChannel ? "✓ Ativo" : "✕ Oculto"}
                      </span>
                    </Button>

                    <Button
                      type="button"
                      onClick={() =>
                        setEditingCategory({
                          ...editingCategory,
                          qrMesaChannel: !editingCategory.qrMesaChannel,
                        })
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        padding: "12px 8px",
                        borderRadius: "8px",
                        border: editingCategory.qrMesaChannel
                          ? "1.5px solid var(--gm-brand)"
                          : "1px solid var(--gm-border)",
                        background: editingCategory.qrMesaChannel
                          ? "rgba(16, 185, 129, 0.08)"
                          : "var(--gm-surface-soft)",
                        color: "var(--gm-ink)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    >
                      <Icon name="counter" size={20} />
                      <strong style={{ fontSize: "0.8rem", textAlign: "center" }}>
                        Cardápio QR Mesa
                      </strong>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: editingCategory.qrMesaChannel ? "#10b981" : "var(--gm-muted)",
                          fontWeight: 700,
                        }}
                      >
                        {editingCategory.qrMesaChannel ? "✓ Ativo" : "✕ Oculto"}
                      </span>
                    </Button>

                    <Button
                      type="button"
                      onClick={() =>
                        setEditingCategory({
                          ...editingCategory,
                          deliveryChannel: !editingCategory.deliveryChannel,
                        })
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        padding: "12px 8px",
                        borderRadius: "8px",
                        border: editingCategory.deliveryChannel
                          ? "1.5px solid var(--gm-brand)"
                          : "1px solid var(--gm-border)",
                        background: editingCategory.deliveryChannel
                          ? "rgba(16, 185, 129, 0.08)"
                          : "var(--gm-surface-soft)",
                        color: "var(--gm-ink)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    >
                      <Icon name="delivery" size={20} />
                      <strong style={{ fontSize: "0.8rem", textAlign: "center" }}>
                        Delivery Web
                      </strong>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: editingCategory.deliveryChannel ? "#10b981" : "var(--gm-muted)",
                          fontWeight: 700,
                        }}
                      >
                        {editingCategory.deliveryChannel ? "✓ Ativo" : "✕ Oculto"}
                      </span>
                    </Button>
                  </div>
                </div>

                {/* Estação de produção padrão */}
                <Label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    fontSize: "0.84rem",
                    fontWeight: 700,
                    color: "var(--gm-ink)",
                  }}
                >
                  Estação de produção padrão para novos itens
                  <NativeSelect
                    value={editingCategory.defaultStationId}
                    onChange={(e) =>
                      setEditingCategory({
                        ...editingCategory,
                        defaultStationId: e.target.value,
                      })
                    }
                    style={{
                      width: "100%",
                      height: "40px",
                      padding: "0 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface)",
                      color: "var(--gm-ink)",
                      fontSize: "0.86rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">Nenhuma estação fixa (definir individualmente)</option>
                    {catalog.stations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>

                {/* Programação por Horário */}
                <div
                  style={{
                    border: "1px solid var(--gm-border)",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    background: "var(--gm-surface-soft)",
                  }}
                >
                  <Label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "0.84rem",
                      fontWeight: 700,
                      color: "var(--gm-ink)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      className="accent-primary"
                      type="checkbox"
                      checked={editingCategory.hasSchedule}
                      onChange={(e) =>
                        setEditingCategory({
                          ...editingCategory,
                          hasSchedule: e.target.checked,
                        })
                      }
                      style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <span>Restringir Horário de Venda Desta Categoria</span>
                  </Label>

                  {editingCategory.hasSchedule ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "10px",
                        marginTop: "10px",
                      }}
                    >
                      <Label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          fontSize: "0.76rem",
                          fontWeight: 600,
                          color: "var(--gm-muted)",
                        }}
                      >
                        Início
                        <Input
                          type="time"
                          value={editingCategory.startTime}
                          onChange={(e) =>
                            setEditingCategory({
                              ...editingCategory,
                              startTime: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            height: "36px",
                            padding: "0 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--gm-border)",
                            background: "var(--gm-surface)",
                            color: "var(--gm-ink)",
                            boxSizing: "border-box",
                          }}
                        />
                      </Label>
                      <Label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                          fontSize: "0.76rem",
                          fontWeight: 600,
                          color: "var(--gm-muted)",
                        }}
                      >
                        Término
                        <Input
                          type="time"
                          value={editingCategory.endTime}
                          onChange={(e) =>
                            setEditingCategory({
                              ...editingCategory,
                              endTime: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            height: "36px",
                            padding: "0 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--gm-border)",
                            background: "var(--gm-surface)",
                            color: "var(--gm-ink)",
                            boxSizing: "border-box",
                          }}
                        />
                      </Label>
                    </div>
                  ) : (
                    <span
                      style={{
                        display: "block",
                        marginTop: "4px",
                        fontSize: "0.74rem",
                        color: "var(--gm-muted)",
                      }}
                    >
                      Disponível durante todo o expediente.
                    </span>
                  )}
                </div>
              </>
            }

            {/* Rodapé com Ações */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                marginTop: "6px",
                borderTop: "1px solid var(--gm-border)",
                paddingTop: "14px",
              }}
            >
              <Button variant="ghost" onClick={() => setEditingCategory(null)}>
                Cancelar
              </Button>
              <Button
                disabled={busy === "update-category" || editingCategory.name.trim().length < 2}
                type="submit"
                variant="primary"
              >
                {busy === "update-category" ? "Salvando…" : "Salvar Configurações"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal de Reorganização Geral das Categorias */}
      {reorderModalOpen && (
        <Modal
          isOpen={reorderModalOpen}
          onClose={() => setReorderModalOpen(false)}
          title="Reorganizar Ordem das Categorias no Cardápio"
          size="md"
        >
          <div className="catalog-stack catalog-stack--14">
            <p className="catalog-muted-copy-084">
              Ajuste a ordem em que as categorias e seus produtos aparecem para a sua equipe e no
              cardápio dos clientes.
            </p>

            <div className="catalog-stack catalog-stack--8">
              {catalog.categories.map((cat, idx) => {
                const prodCount = catalog.products.filter((p) => p.categoryId === cat.id).length;
                return (
                  <div
                    key={cat.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface)",
                    }}
                  >
                    <div className="catalog-inline-center-10">
                      <span
                        style={{
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          background: "var(--gm-surface-soft)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          color: "var(--gm-muted)",
                        }}
                      >
                        {idx + 1}
                      </span>
                      <div>
                        <strong style={{ fontSize: "0.9rem", color: "var(--gm-ink)" }}>
                          {cat.name}
                        </strong>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--gm-muted)",
                            marginLeft: "8px",
                          }}
                        >
                          ({prodCount} {prodCount === 1 ? "produto" : "produtos"})
                        </span>
                      </div>
                    </div>

                    <div className="catalog-inline-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === 0}
                        onClick={() => moveCategory(cat.id, "up")}
                        title="Subir posição"
                      >
                        <Icon name="arrow-up" size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === catalog.categories.length - 1}
                        onClick={() => moveCategory(cat.id, "down")}
                        title="Descer posição"
                      >
                        <Icon name="arrow-down" size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="catalog-actions-end">
              <Button variant="primary" onClick={() => setReorderModalOpen(false)}>
                Concluir Reordenação
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <CatalogProductEditorModal
        autoTranslateProduct={autoTranslateProduct}
        busy={busy}
        catalog={catalog}
        editingProduct={editingProduct}
        editingProductDeliveryPrice={editingProductDeliveryPrice}
        editingProductPrice={editingProductPrice}
        editingProductReason={editingProductReason}
        production
        scope={scope}
        setEditingProduct={setEditingProduct}
        setEditingProductDeliveryPrice={setEditingProductDeliveryPrice}
        setEditingProductPrice={setEditingProductPrice}
        setEditingProductReason={setEditingProductReason}
        uploadProductImage={uploadProductImage}
        updateProduct={updateProduct}
      />

      {/* Modal: Matriz de Engenharia de Cardápio (BCG) */}

      <CatalogBcgModal
        bcgProducts={bcgProducts}
        onClose={() => setMatrixModalOpen(false)}
        open={matrixModalOpen}
        products={catalog.products}
      />

      {/* Modal: Simulador "Ver como o Cliente Vê" + Gerador de QR Code */}
      {qrPreviewModalOpen && (
        <Modal
          isOpen={qrPreviewModalOpen}
          title="Prévia do Cardápio do Cliente & Gerador de QR Code de Mesa"
          onClose={() => setQrPreviewModalOpen(false)}
        >
          <div
            style={{
              display: "flex",
              gap: "24px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {/* Simulador de Smartphone */}
            <div
              style={{
                width: "340px",
                height: "560px",
                borderRadius: "32px",
                border: "8px solid #1e293b",
                background: "#ffffff",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Top Notch */}
              <div
                style={{
                  height: "24px",
                  background: "#1e293b",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: "60px",
                    height: "4px",
                    borderRadius: "2px",
                    background: "#475569",
                  }}
                />
              </div>

              {/* App Header */}
              <div
                style={{
                  padding: "12px 16px",
                  background: "var(--gm-brand, #2563eb)",
                  color: "#ffffff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                    {tableQrs[selectedQrTable]
                      ? tableQrs[selectedQrTable].label
                      : `Mesa #${selectedQrTable}`}
                  </div>
                  <strong style={{ fontSize: "1rem" }}>GiroMesa Bistrô</strong>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.2)",
                    padding: "4px 8px",
                    borderRadius: "9999px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {Object.values(clientSimulatorCart).reduce((a, b) => a + b, 0)} itens
                </div>
              </div>

              {/* Category Tabs */}
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  padding: "8px 12px",
                  background: "#f8fafc",
                  overflowX: "auto",
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                {catalog.categories.map((c, i) => (
                  <span
                    key={c.id}
                    style={{
                      fontSize: "0.72rem",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      background: i === 0 ? "var(--gm-brand)" : "#e2e8f0",
                      color: i === 0 ? "#fff" : "#475569",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </span>
                ))}
              </div>

              {/* Product List */}
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {catalog.products
                  .filter((p) => p.available && p.active)
                  .map((p) => {
                    const qty = clientSimulatorCart[p.id] || 0;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          gap: "10px",
                          padding: "8px",
                          borderRadius: "10px",
                          border: "1px solid #e2e8f0",
                          background: "#ffffff",
                        }}
                      >
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            style={{
                              width: "54px",
                              height: "54px",
                              borderRadius: "8px",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "54px",
                              height: "54px",
                              borderRadius: "8px",
                              background: "#f1f5f9",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Icon name="catalog" size={20} />
                          </div>
                        )}
                        <div
                          style={{
                            flex: 1,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: "0.82rem",
                                fontWeight: 700,
                                color: "#0f172a",
                              }}
                            >
                              {p.name}
                            </div>
                            <div
                              style={{
                                fontSize: "0.78rem",
                                fontWeight: 800,
                                color: "var(--gm-brand)",
                              }}
                            >
                              {formatMoney(p.priceCents)}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "flex-end",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            {qty > 0 && (
                              <Button
                                type="button"
                                onClick={() =>
                                  setClientSimulatorCart({
                                    ...clientSimulatorCart,
                                    [p.id]: Math.max(0, qty - 1),
                                  })
                                }
                                style={{
                                  width: "22px",
                                  height: "22px",
                                  borderRadius: "4px",
                                  border: "1px solid #cbd5e1",
                                  background: "#f8fafc",
                                  cursor: "pointer",
                                  fontWeight: 700,
                                }}
                              >
                                -
                              </Button>
                            )}
                            {qty > 0 && (
                              <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>{qty}</span>
                            )}
                            <Button
                              type="button"
                              onClick={() =>
                                setClientSimulatorCart({
                                  ...clientSimulatorCart,
                                  [p.id]: qty + 1,
                                })
                              }
                              style={{
                                padding: "2px 8px",
                                borderRadius: "4px",
                                border: "none",
                                background: "var(--gm-brand)",
                                color: "#fff",
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              + Adicionar
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Gerador de QR Code de Mesa */}
            <div
              style={{
                width: "300px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <div
                style={{
                  padding: "16px",
                  borderRadius: "12px",
                  border: "1px solid var(--gm-border)",
                  background: "var(--gm-surface-sunken)",
                  textAlign: "center",
                }}
              >
                {publication && (
                  <div className="gm-observability-row">
                    <span className="gm-pill" data-tone="positive">
                      Publicado · versão {publication.version}
                    </span>
                  </div>
                )}
                <Label
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    display: "block",
                    marginBottom: "8px",
                  }}
                >
                  Selecione a Mesa para Gerar o QR Code
                  <NativeSelect
                    value={selectedQrTable}
                    onChange={(e) => setSelectedQrTable(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "6px",
                      border: "1px solid var(--gm-border)",
                      marginTop: "4px",
                      background: "var(--gm-surface)",
                      color: "var(--gm-ink)",
                    }}
                  >
                    {tableQrs.map((row, index) => (
                      <option key={row.tableId} value={index}>
                        {row.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>

                <div
                  style={{
                    background: "#ffffff",
                    padding: "16px",
                    borderRadius: "12px",
                    margin: "14px auto",
                    width: "160px",
                    height: "160px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
                  }}
                >
                  {tableQrs[selectedQrTable] ? (
                    <a
                      href={tableQrs[selectedQrTable].url}
                      rel="noreferrer"
                      target="_blank"
                      title="Abrir cardápio público desta mesa"
                    >
                      <img
                        alt={`QR Code ${tableQrs[selectedQrTable].label}`}
                        height={130}
                        src={tableQrs[selectedQrTable].dataUrl}
                        width={130}
                      />
                    </a>
                  ) : (
                    <Icon name="catalog" size={64} />
                  )}
                  <span
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 800,
                      color: "#0f172a",
                      marginTop: "2px",
                    }}
                  >
                    {tableQrs[selectedQrTable]
                      ? tableQrs[selectedQrTable].label.toUpperCase()
                      : `MESA #${selectedQrTable}`}
                  </span>
                </div>

                <Button
                  variant="primary"
                  onClick={printSelectedTableQr}
                  style={{
                    width: "100%",
                    display: "inline-flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Icon name="download" size={14} />
                  <span>Imprimir Display de Mesa</span>
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Gerador de Etiquetas de Vitrine / Placas de Mesa */}
      {printableLabelsModalOpen && (
        <Modal
          isOpen={printableLabelsModalOpen}
          title="Gerador de Etiquetas de Vitrine & Displays de Balcão"
          onClose={() => setPrintableLabelsModalOpen(false)}
        >
          <div className="catalog-stack catalog-stack--16">
            <div className="catalog-between">
              <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--gm-muted)" }}>
                Visualização pronta para impressão de cartões de identificação de vitrines e
                prateleiras.
              </p>
              <Button
                variant="primary"
                onClick={() => window.print()}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Icon name="download" size={14} />
                <span>Imprimir Folha (PDF)</span>
              </Button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: "12px",
                maxHeight: "460px",
                overflowY: "auto",
                padding: "10px",
                background: "#f8fafc",
                borderRadius: "10px",
              }}
            >
              {catalog.products
                .filter((p) => p.active)
                .map((p) => (
                  <div
                    key={p.id}
                    style={{
                      background: "#ffffff",
                      border: "1.5px solid #0f172a",
                      borderRadius: "8px",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      minHeight: "120px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "0.68rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "#64748b",
                          fontWeight: 700,
                        }}
                      >
                        {catalog.categories.find((c) => c.id === p.categoryId)?.name || "Prato"}
                      </div>
                      <strong
                        style={{
                          fontSize: "0.95rem",
                          color: "#0f172a",
                          display: "block",
                          marginTop: "2px",
                        }}
                      >
                        {p.name}
                      </strong>
                      {p.description && (
                        <p
                          style={{
                            margin: "4px 0 0 0",
                            fontSize: "0.72rem",
                            color: "#64748b",
                            lineHeight: 1.3,
                          }}
                        >
                          {p.description}
                        </p>
                      )}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-end",
                        marginTop: "12px",
                        borderTop: "1px dashed #cbd5e1",
                        paddingTop: "8px",
                      }}
                    >
                      <div>
                        {p.allergenIds?.length > 0 && (
                          <span style={{ fontSize: "0.65rem", color: "#dc2626", fontWeight: 700 }}>
                            Contém: {p.allergenIds.join(", ")}
                          </span>
                        )}
                      </div>
                      <strong style={{ fontSize: "1.1rem", color: "#0f172a" }}>
                        {formatMoney(p.priceCents)}
                      </strong>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal de Configuração Rápida de Produto de Revenda (Inbox do Estoque) */}

      {/* Modal de Configuração em Lote de Produtos de Revenda (Inbox do Estoque) */}

      {/* Modal 1: Gerenciador de Grupos de Modificadores & Complementos */}
      {modifiersManagerModalOpen && (
        <Modal
          isOpen={modifiersManagerModalOpen}
          onClose={() => setModifiersManagerModalOpen(false)}
          title="Grupos de Opcionais & Modificadores do Cardápio"
          size="lg"
        >
          <div className="catalog-stack catalog-stack--16">
            <div className="catalog-between">
              <p className="catalog-muted-copy-084">
                Crie e gerencie grupos de complementos (ex: Ponto da Carne, Turbine seu Burger,
                Molhos) reutilizáveis em qualquer prato.
              </p>
            </div>

            {/* Formulário de Novo Grupo */}
            <div
              style={{
                padding: "14px 16px",
                background: "var(--gm-surface-soft)",
                borderRadius: "10px",
                border: "1px solid var(--gm-border)",
              }}
            >
              <strong
                style={{
                  fontSize: "0.86rem",
                  color: "var(--gm-ink)",
                  display: "block",
                  marginBottom: "10px",
                }}
              >
                + Criar Novo Grupo de Opcionais
              </strong>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 1fr 1fr auto",
                  gap: "10px",
                  alignItems: "flex-end",
                }}
              >
                <Label className="gm-field catalog-field--compact">
                  Nome do Grupo *
                  <Input
                    placeholder="Ex: Ponto da Carne, Adicionais..."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    style={{
                      height: "36px",
                      padding: "0 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface)",
                      color: "var(--gm-ink)",
                    }}
                  />
                </Label>
                <Label className="gm-field catalog-field--compact">
                  Mínimo de Escolhas
                  <Input
                    type="number"
                    min={0}
                    value={newGroupMin}
                    onChange={(e) => setNewGroupMin(Number(e.target.value))}
                    style={{
                      height: "36px",
                      padding: "0 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface)",
                      color: "var(--gm-ink)",
                    }}
                  />
                </Label>
                <Label className="gm-field catalog-field--compact">
                  Máximo de Escolhas
                  <Input
                    type="number"
                    min={1}
                    value={newGroupMax}
                    onChange={(e) => setNewGroupMax(Number(e.target.value))}
                    style={{
                      height: "36px",
                      padding: "0 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface)",
                      color: "var(--gm-ink)",
                    }}
                  />
                </Label>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={newGroupName.trim().length < 2}
                  onClick={() => void createManagerModifierGroup()}
                  style={{ height: "36px", whiteSpace: "nowrap" }}
                >
                  <Icon name="plus" size={13} />
                  <span>Adicionar Grupo</span>
                </Button>
              </div>
            </div>

            {/* Lista de Grupos Existentes com suas Opções */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                maxHeight: "400px",
                overflowY: "auto",
                paddingRight: "4px",
              }}
            >
              {catalog.groups.map((grp) => {
                const groupOptions = catalog.options.filter((opt) => opt.groupId === grp.id);
                const isEditing = editingGroupId === grp.id;

                return (
                  <div
                    key={grp.id}
                    style={{
                      border: "1px solid var(--gm-border)",
                      borderRadius: "10px",
                      padding: "14px 16px",
                      background: "var(--gm-surface)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "10px",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "0.95rem", color: "var(--gm-ink)" }}>
                          {grp.name}
                        </strong>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--gm-muted)",
                            marginLeft: "10px",
                          }}
                        >
                          {grp.minimumSelections > 0 ? "Obrigatório" : "Opcional"} • Escolha de{" "}
                          {grp.minimumSelections} até {grp.maximumSelections} opções (
                          {groupOptions.length} cadastradas)
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <Button
                          type="button"
                          className="catalog-card-icon-btn"
                          onClick={() => setEditingGroupId(isEditing ? null : grp.id)}
                          title="Adicionar / Editar opções deste grupo"
                        >
                          <Icon name="plus" size={14} />
                        </Button>
                        <Button
                          type="button"
                          className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                          disabled={busy === `modifier-group-${grp.id}`}
                          onClick={() => void removeModifierGroup(grp.id)}
                          title="Excluir Grupo"
                        >
                          <Icon name="x" size={14} />
                        </Button>
                      </div>
                    </div>

                    {/* Lista de Opções do Grupo */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                        marginBottom: isEditing ? "12px" : "0",
                      }}
                    >
                      {groupOptions.map((opt) => (
                        <div
                          key={opt.id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            background: "var(--gm-surface-soft)",
                            border: "1px solid var(--gm-border)",
                            fontSize: "0.8rem",
                          }}
                        >
                          <span style={{ color: "var(--gm-ink)", fontWeight: 600 }}>
                            {opt.name}
                          </span>
                          <span
                            style={{
                              color: opt.priceDeltaCents > 0 ? "#059669" : "var(--gm-muted)",
                              fontWeight: 700,
                            }}
                          >
                            {opt.priceDeltaCents > 0
                              ? `+${formatMoney(opt.priceDeltaCents)}`
                              : "Grátis"}
                          </span>
                          <Button
                            type="button"
                            disabled={busy === `modifier-option-${opt.id}`}
                            onClick={() => void removeModifierOption(opt.id)}
                            style={{
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              color: "var(--gm-muted)",
                              padding: "0 2px",
                            }}
                            title="Remover opção"
                          >
                            <Icon name="x" size={11} />
                          </Button>
                        </div>
                      ))}
                      {groupOptions.length === 0 && (
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--gm-muted)",
                            fontStyle: "italic",
                          }}
                        >
                          Nenhuma opção cadastrada neste grupo.
                        </span>
                      )}
                    </div>

                    {/* Formulário Rápido para Adicionar Opção ao Grupo */}
                    {isEditing && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1fr auto",
                          gap: "8px",
                          marginTop: "10px",
                          paddingTop: "10px",
                          borderTop: "1px dashed var(--gm-border)",
                        }}
                      >
                        <Input
                          placeholder="Nome da Opção (ex: Bacon Extra)"
                          value={newOptionName}
                          onChange={(e) => setNewOptionName(e.target.value)}
                          style={{
                            height: "34px",
                            padding: "0 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--gm-border)",
                            background: "var(--gm-surface)",
                            color: "var(--gm-ink)",
                            fontSize: "0.82rem",
                          }}
                        />
                        <Input
                          placeholder="Preço Adicional (ex: 5,00)"
                          value={newOptionPrice}
                          onChange={(e) => setNewOptionPrice(e.target.value)}
                          style={{
                            height: "34px",
                            padding: "0 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--gm-border)",
                            background: "var(--gm-surface)",
                            color: "var(--gm-ink)",
                            fontSize: "0.82rem",
                          }}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={newOptionName.trim().length === 0}
                          onClick={() => void addModifierOption(grp)}
                        >
                          + Adicionar Opção
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="catalog-actions-end">
              <Button variant="primary" onClick={() => setModifiersManagerModalOpen(false)}>
                Concluir
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal 2: Simulador de Customização de Pedido com Modificadores */}
      {modifierCustomizerProduct && (
        <Modal
          isOpen={modifierCustomizerProduct !== null}
          onClose={() => setModifierCustomizerProduct(null)}
          title={`Simulador de Pedido: ${modifierCustomizerProduct.name}`}
          size="md"
        >
          <div className="catalog-stack catalog-stack--16">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                borderBottom: "1px solid var(--gm-border)",
                paddingBottom: "10px",
              }}
            >
              <div>
                <strong style={{ fontSize: "1rem", color: "var(--gm-ink)" }}>
                  {modifierCustomizerProduct.name}
                </strong>
                <span style={{ fontSize: "0.8rem", color: "var(--gm-muted)", display: "block" }}>
                  Preço Base: {formatMoney(modifierCustomizerProduct.priceCents)}
                </span>
              </div>
              {(() => {
                let total = modifierCustomizerProduct.priceCents;
                Object.values(customizerSelections)
                  .flat()
                  .forEach((optId) => {
                    const opt = catalog.options.find((o) => o.id === optId);
                    if (opt) total += opt.priceDeltaCents;
                  });
                return (
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: "0.74rem", color: "var(--gm-muted)" }}>
                      Total Customizado
                    </span>
                    <strong
                      style={{
                        fontSize: "1.2rem",
                        color: "var(--gm-brand)",
                        display: "block",
                      }}
                    >
                      {formatMoney(total)}
                    </strong>
                  </div>
                );
              })()}
            </div>

            {/* Grupos de Modificadores deste Produto */}
            <div className="catalog-stack catalog-stack--14">
              {modifierCustomizerProduct.modifierGroupIds.map((grpId) => {
                const grp = catalog.groups.find((g) => g.id === grpId);
                if (!grp) return null;
                const grpOpts = catalog.options.filter((o) => o.groupId === grp.id);
                const currentSelected = customizerSelections[grp.id] || [];

                return (
                  <div
                    key={grp.id}
                    style={{
                      background: "var(--gm-surface-soft)",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                    }}
                  >
                    <div className="catalog-between catalog-between--mb8">
                      <strong style={{ fontSize: "0.86rem", color: "var(--gm-ink)" }}>
                        {grp.name}
                      </strong>
                      <span className="catalog-muted-072">
                        {grp.minimumSelections > 0 ? "Obrigatório" : "Opcional"} (escolha até{" "}
                        {grp.maximumSelections})
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                      {grpOpts.map((opt) => {
                        const isSelected = currentSelected.includes(opt.id);
                        return (
                          <Button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              let next: string[];
                              if (grp.maximumSelections === 1) {
                                next = isSelected ? [] : [opt.id];
                              } else {
                                if (isSelected)
                                  next = currentSelected.filter((id) => id !== opt.id);
                                else if (currentSelected.length < grp.maximumSelections)
                                  next = [...currentSelected, opt.id];
                                else next = currentSelected;
                              }
                              setCustomizerSelections({
                                ...customizerSelections,
                                [grp.id]: next,
                              });
                            }}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "8px 10px",
                              borderRadius: "6px",
                              border: isSelected
                                ? "1.5px solid var(--gm-brand)"
                                : "1px solid var(--gm-border)",
                              background: isSelected
                                ? "rgba(16, 185, 129, 0.08)"
                                : "var(--gm-surface)",
                              color: "var(--gm-ink)",
                              fontSize: "0.8rem",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span>{opt.name}</span>
                            <span
                              style={{
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                color: opt.priceDeltaCents > 0 ? "#059669" : "var(--gm-muted)",
                              }}
                            >
                              {opt.priceDeltaCents > 0
                                ? `+${formatMoney(opt.priceDeltaCents)}`
                                : "Grátis"}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "6px",
              }}
            >
              <Button variant="primary" onClick={() => setModifierCustomizerProduct(null)}>
                Fechar Simulador
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal 3: Combos & Promoções / Happy Hour */}

      <CatalogPromotionsModal
        busy={busy}
        catalog={catalog}
        completeCreateAttempt={completeCreateAttempt}
        createAttemptKey={createAttemptKey}
        feedback={setFeedback}
        onClose={() => setPromosAndCombosModalOpen(false)}
        onRetry={onRetry}
        open={promosAndCombosModalOpen}
        scope={scope}
        setBusy={setBusy}
      />

      {/* Modal 4: Exportador / Impressor de Cardápio em PDF Elegante */}
      {pdfExportModalOpen && (
        <Modal
          isOpen={pdfExportModalOpen}
          onClose={() => setPdfExportModalOpen(false)}
          title="Exportar Cardápio em PDF / Impressão de Mesa"
          size="xl"
        >
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "20px" }}>
            {/* Painel de Controles e Opções */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "14px",
                paddingRight: "14px",
                borderRight: "1px solid var(--gm-border)",
              }}
            >
              <strong style={{ fontSize: "0.88rem", color: "var(--gm-ink)" }}>
                Opções de Layout
              </strong>

              <div className="catalog-stack catalog-stack--8">
                <Label className="catalog-clickable-row">
                  <input
                    className="accent-primary"
                    type="radio"
                    name="pdfLayout"
                    checked={pdfLayoutMode === "modern"}
                    onChange={() => setPdfLayoutMode("modern")}
                  />
                  <span>Moderno Gastronômico (com fotos)</span>
                </Label>
                <Label className="catalog-clickable-row">
                  <input
                    className="accent-primary"
                    type="radio"
                    name="pdfLayout"
                    checked={pdfLayoutMode === "bistro"}
                    onChange={() => setPdfLayoutMode("bistro")}
                  />
                  <span>Bistrô Minimalista (2 Colunas)</span>
                </Label>
              </div>

              <strong style={{ fontSize: "0.88rem", color: "var(--gm-ink)", marginTop: "8px" }}>
                Elementos Exibidos
              </strong>

              <div className="catalog-stack catalog-stack--8">
                <Label className="catalog-clickable-row">
                  <input
                    className="accent-primary"
                    type="checkbox"
                    checked={pdfShowPhotos}
                    onChange={(e) => setPdfShowPhotos(e.target.checked)}
                  />
                  <span>Incluir Fotos dos Pratos</span>
                </Label>
                <Label className="catalog-clickable-row">
                  <input
                    className="accent-primary"
                    type="checkbox"
                    checked={pdfShowDescriptions}
                    onChange={(e) => setPdfShowDescriptions(e.target.checked)}
                  />
                  <span>Incluir Descrições & Ingredientes</span>
                </Label>
                <Label className="catalog-clickable-row">
                  <input
                    className="accent-primary"
                    type="checkbox"
                    checked={pdfShowQr}
                    onChange={(e) => setPdfShowQr(e.target.checked)}
                  />
                  <span>Incluir QR Code de Autoatendimento</span>
                </Label>
              </div>

              <div
                style={{
                  marginTop: "auto",
                  paddingTop: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                <Button
                  variant="primary"
                  onClick={handlePrintMenuPdf}
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    height: "42px",
                    fontWeight: 700,
                  }}
                >
                  <Icon name="download" size={16} />
                  <span>Imprimir / Salvar em PDF</span>
                </Button>
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--gm-muted)",
                    textAlign: "center",
                  }}
                >
                  Utilize a opção "Salvar como PDF" na janela de impressão do seu navegador.
                </span>
              </div>
            </div>

            {/* Preview da Folha A4 do Cardápio */}
            <div
              style={{
                background: "#ffffff",
                color: "#1e293b",
                borderRadius: "8px",
                padding: "28px 32px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                maxHeight: "560px",
                overflowY: "auto",
                fontFamily: "Georgia, serif",
              }}
            >
              {/* Cabeçalho do Cardápio Dinâmico com Branding */}
              <div
                style={{
                  textAlign: "center",
                  borderBottom: `2px solid ${catalog.branding?.brandColor || "#0f172a"}`,
                  paddingBottom: "16px",
                  marginBottom: "20px",
                }}
              >
                <h1
                  style={{
                    margin: 0,
                    fontSize: "1.8rem",
                    letterSpacing: "2px",
                    textTransform: "uppercase",
                    color: "#0f172a",
                    fontWeight: 700,
                  }}
                >
                  {catalog.branding?.restaurantName || "GiroMesa Bistrô & Bar"}
                </h1>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    fontSize: "0.86rem",
                    color: "#64748b",
                    fontStyle: "italic",
                    fontFamily: "sans-serif",
                  }}
                >
                  {catalog.branding?.slogan || "Cardápio Autoral & Gastronomia Artesanal"}
                </p>
                {catalog.branding?.serviceTaxNotice && (
                  <p
                    style={{
                      margin: "4px 0 0 0",
                      fontSize: "0.72rem",
                      color: "#94a3b8",
                      fontFamily: "sans-serif",
                    }}
                  >
                    {catalog.branding.serviceTaxNotice} • {catalog.branding.wifiNotice}
                  </p>
                )}
              </div>

              {/* Conteúdo por Categoria */}
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                {catalog.categories.map((cat) => {
                  const catProducts = catalog.products.filter(
                    (p) => p.categoryId === cat.id && p.active,
                  );
                  if (catProducts.length === 0) return null;

                  return (
                    <div key={cat.id}>
                      <div style={{ textAlign: "center", marginBottom: "12px" }}>
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "1.15rem",
                            textTransform: "uppercase",
                            letterSpacing: "1.5px",
                            color: "#0f172a",
                          }}
                        >
                          — {cat.name} —
                        </h3>
                        {cat.description && (
                          <p
                            style={{
                              margin: "2px 0 0 0",
                              fontSize: "0.78rem",
                              color: "#64748b",
                              fontStyle: "italic",
                              fontFamily: "sans-serif",
                            }}
                          >
                            {cat.description}
                          </p>
                        )}
                      </div>

                      <div
                        style={{
                          display: pdfLayoutMode === "bistro" ? "grid" : "flex",
                          gridTemplateColumns: "1fr 1fr",
                          flexDirection: "column",
                          gap: "12px",
                        }}
                      >
                        {catProducts.map((prod) => (
                          <div
                            key={prod.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: "12px",
                              borderBottom: "1px dotted #cbd5e1",
                              paddingBottom: "6px",
                            }}
                          >
                            <div className="catalog-grow">
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "baseline",
                                }}
                              >
                                <strong style={{ fontSize: "0.92rem", color: "#0f172a" }}>
                                  {prod.name}
                                </strong>
                                <span
                                  style={{
                                    fontSize: "0.95rem",
                                    fontWeight: 700,
                                    color: "#0f172a",
                                    fontFamily: "sans-serif",
                                    marginLeft: "8px",
                                  }}
                                >
                                  {formatMoney(prod.priceCents)}
                                </span>
                              </div>
                              {pdfShowDescriptions && prod.description && (
                                <p
                                  style={{
                                    margin: "3px 0 0 0",
                                    fontSize: "0.78rem",
                                    color: "#475569",
                                    lineHeight: 1.35,
                                    fontFamily: "sans-serif",
                                  }}
                                >
                                  {prod.description}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Rodapé com QR Code */}
              {pdfShowQr && (
                <div
                  style={{
                    marginTop: "28px",
                    paddingTop: "16px",
                    borderTop: "1px solid #cbd5e1",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontFamily: "sans-serif",
                  }}
                >
                  <div>
                    <strong style={{ fontSize: "0.82rem", color: "#0f172a", display: "block" }}>
                      Peça também pelo celular
                    </strong>
                    <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
                      Aponte a câmera para o QR Code da sua mesa
                    </span>
                  </div>
                  <div
                    style={{
                      padding: "6px",
                      background: "#f8fafc",
                      borderRadius: "6px",
                      border: "1px solid #e2e8f0",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      color: "#0f172a",
                    }}
                  >
                    [ QR CODE DA MESA ]
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
