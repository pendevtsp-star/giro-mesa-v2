import { Button, EmptyState, Icon, Modal, Toast } from "@giromesa/ui";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  api,
  type CatalogBcgProduct,
  type CatalogPublication,
  type CatalogTableQr,
} from "../../api";
import {
  type CatalogBrandingSettings,
  type CatalogCombo,
  type CatalogProduct,
  type CatalogPromotionRule,
  type DietaryTag,
  type ModifierGroup,
  type ModifierOption,
  type PendingStockProductSuggestion,
  type PilotCatalog,
  type PilotCatalogCategory,
  type PilotScope,
  type ProductSizeVariation,
  priceToCents,
  type RecipeIngredient,
  RemoteGate,
  type SpicinessLevel,
  slugify,
} from "../../operations.shared";
import { formatMoney } from "../../rules";
import {
  hasCatalogProductionStation,
  normalizeCatalogStationIds,
  toggleCatalogStationId,
} from "./catalog.stations";
import { CatalogFilters } from "./components/CatalogFilters";
import { CatalogManagementHeader } from "./components/CatalogManagementHeader";
import { CatalogProductEditorModal } from "./components/CatalogProductEditorModal";
import { CatalogProductsPanel } from "./components/CatalogProductsPanel";
import { StockInbox } from "./components/StockInbox";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });
}

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

  const remote = { state: { status: "success" as const, data: catalog }, retry: () => {} };

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
  const [productCest, setProductCest] = useState("");
  const [productOrigin, setProductOrigin] = useState<number>(0);

  async function updateProductInlinePrice(productId: string, newPriceCents: number) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (scope && product) {
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
      return;
    }
    setCatalog((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.id === productId ? { ...p, priceCents: newPriceCents } : p,
      ),
    }));
  }

  async function updateProductInlineDeliveryPrice(
    productId: string,
    newDeliveryPriceCents: number,
  ) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (scope && product) {
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
      return;
    }
    setCatalog((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.id === productId ? { ...p, deliveryPriceCents: newDeliveryPriceCents } : p,
      ),
    }));
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
  const bcgByProductId = new Map(bcgProducts.map((product) => [product.productId, product]));

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
  const [promoTab, setPromoTab] = useState<"combos" | "happyhour">("combos");
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

  // Novo Combo State
  const [newComboName, setNewComboName] = useState("");
  const [newComboDesc, setNewComboDesc] = useState("");
  const [newComboPrice, setNewComboPrice] = useState("");
  const [newComboProductIds, setNewComboProductIds] = useState<string[]>([]);
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
    if (!match) throw new Error("Formato de imagem não suportado.");
    const result = await api.pilot.uploadCatalogMedia(scope.organizationId, scope.unitId, {
      fileName,
      mimeType: match[1] as "image/jpeg" | "image/png" | "image/webp",
      base64: match[2]!,
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
      rows.map(async (row) => ({
        ...row,
        dataUrl: await QRCode.toDataURL(row.url, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 320,
        }),
      })),
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

  async function openQrGenerator() {
    setBusy("table-qrs");
    try {
      await loadRealTableQrs();
      setQrModalOpen(true);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao carregar QR Codes.", "danger");
    } finally {
      setBusy("");
    }
  }

  // Branding Modal State
  const [brandingModalOpen, setBrandingModalOpen] = useState(false);
  const [restaurantName, setRestaurantName] = useState(catalog.branding?.restaurantName ?? "");
  const [restaurantSlogan, setRestaurantSlogan] = useState(catalog.branding?.slogan ?? "");
  const [restaurantLogoUrl, setRestaurantLogoUrl] = useState<string>(
    catalog.branding?.headerBannerUrl || "",
  );
  const [restaurantLogoFileName, setRestaurantLogoFileName] = useState("");
  const [restaurantAddress, setRestaurantAddress] = useState(catalog.branding?.address ?? "");
  const [restaurantPhone, setRestaurantPhone] = useState(catalog.branding?.phone ?? "");
  const [restaurantInstagram, setRestaurantInstagram] = useState(catalog.branding?.instagram ?? "");
  const [restaurantOpeningHours, setRestaurantOpeningHours] = useState(
    catalog.branding?.openingHours ?? "",
  );
  const [brandColor, setBrandColor] = useState(catalog.branding?.brandColor || "#10b981");
  const [serviceTaxNotice, setServiceTaxNotice] = useState(
    catalog.branding?.serviceTaxNotice ?? "",
  );
  const [wifiNotice, setWifiNotice] = useState(catalog.branding?.wifiNotice ?? "");
  const [corkageNotice, setCorkageNotice] = useState(catalog.branding?.corkageFeeNotice ?? "");

  useEffect(() => {
    const branding = catalog.branding;
    setRestaurantName(branding?.restaurantName ?? "");
    setRestaurantSlogan(branding?.slogan ?? "");
    setRestaurantLogoUrl(branding?.headerBannerUrl ?? "");
    setRestaurantLogoFileName("");
    setRestaurantAddress(branding?.address ?? "");
    setRestaurantPhone(branding?.phone ?? "");
    setRestaurantInstagram(branding?.instagram ?? "");
    setRestaurantOpeningHours(branding?.openingHours ?? "");
    setBrandColor(branding?.brandColor || "#10b981");
    setServiceTaxNotice(branding?.serviceTaxNotice ?? "");
    setWifiNotice(branding?.wifiNotice ?? "");
    setCorkageNotice(branding?.corkageFeeNotice ?? "");
  }, [catalog.branding]);
  const [promoProductSearch, setPromoProductSearch] = useState("");

  // Happy Hour Campaign Builder State
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);
  const [promoName, setPromoName] = useState("");
  const [promoType, setPromoType] = useState<"percentage" | "fixed_price">("percentage");
  const [promoValue, setPromoValue] = useState("25");
  const [promoDays, setPromoDays] = useState<number[]>([2, 3, 4, 5]); // Ter, Qua, Qui, Sex
  const [promoStart, setPromoStart] = useState("17:30");
  const [promoEnd, setPromoEnd] = useState("20:30");
  const [promoCategoryIds, setPromoCategoryIds] = useState<string[]>([]);
  const [promoProductIds, setPromoProductIds] = useState<string[]>([]);
  const [promoSalon, setPromoSalon] = useState(true);
  const [promoQr, setPromoQr] = useState(true);
  const [promoDelivery, setPromoDelivery] = useState(false);

  async function handlePrintMenuPdf() {
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      alert("Por favor, permita popups para gerar a impressão do cardápio.");
      return;
    }

    let publicMenuQrDataUrl = "";
    let publicMenuUrl = "";
    if (scope && pdfShowQr) {
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
              <span class="menu-item-name">${escapeHtml(prod.name)}</span>
              <span class="menu-item-dots"></span>
              <span class="menu-item-price">${formatMoney(prod.priceCents)}</span>
            </div>
            ${pdfShowDescriptions && prod.description ? `<p class="menu-item-desc">${escapeHtml(prod.description)}</p>` : ""}
            ${prod.pairingSuggestion ? `<p class="menu-item-pairing">★ Harmonização: ${escapeHtml(prod.pairingSuggestion)}</p>` : ""}
          </div>
        `,
          )
          .join("");

        return `
        <div class="category-block">
          <h2 class="category-title">— ${escapeHtml(cat.name.toUpperCase())} —</h2>
          ${cat.description ? `<p class="category-subtitle">${escapeHtml(cat.description)}</p>` : ""}
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
            ${restaurantLogoUrl ? `<img src="${escapeHtml(restaurantLogoUrl)}" class="logo-img" alt="Logo" />` : ""}
            <h1 class="title">${escapeHtml(restaurantName)}</h1>
            <p class="slogan">${escapeHtml(restaurantSlogan)}</p>
            <div class="info-bar">
              ${[restaurantAddress, restaurantPhone, restaurantInstagram]
                .filter(Boolean)
                .map(escapeHtml)
                .join(" • ")}
            </div>
          </div>

          <div class="content">
            ${categoriesHtml}
          </div>

          <div class="footer">
            <div class="footer-text">
              <strong>${escapeHtml(restaurantOpeningHours)}</strong><br>
              ${[serviceTaxNotice, wifiNotice, corkageNotice]
                .filter(Boolean)
                .map(escapeHtml)
                .join(" • ")}
            </div>
            ${
              pdfShowQr
                ? `<div class="qr-box">
                    ${
                      publicMenuQrDataUrl
                        ? `<img src="${publicMenuQrDataUrl}" alt="QR Code do cardápio digital" width="96" height="96" />
                           <span>ACESSE O CARDÁPIO DIGITAL<br><small>${escapeHtml(publicMenuUrl)}</small></span>`
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
  const [productSizes, setProductSizes] = useState<ProductSizeVariation[]>([]);
  const [productSpiciness, setProductSpiciness] = useState<SpicinessLevel>("none");
  const [productDietaryTags, setProductDietaryTags] = useState<DietaryTag[]>([]);
  const [productPairing, setProductPairing] = useState("");
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [editingProductPrice, setEditingProductPrice] = useState("");
  const [editingProductDeliveryPrice, setEditingProductDeliveryPrice] = useState("");

  // Multilingual Catalog Preview State
  const [catalogLanguage, setCatalogLanguage] = useState<"pt" | "en" | "es">("pt");
  const [translatingProduct, setTranslatingProduct] = useState(false);

  // CSV Import/Export Modal State
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvParsedPreview, setCsvParsedPreview] = useState<
    Array<{
      name: string;
      category: string;
      price: number;
      deliveryPrice?: number;
      cost?: number;
      description?: string;
      ncm?: string;
    }>
  >([]);
  const [csvFileName, setCsvFileName] = useState("");

  // QR Codes Generator Modal State
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrStartTable, setQrStartTable] = useState(1);
  const [qrEndTable, setQrEndTable] = useState(15);
  const [qrCustomLabels, setQrCustomLabels] = useState("Balcão 01, Balcão 02, Deck 01, Deck 02");
  const [qrMode, setQrMode] = useState<"range" | "custom">("range");
  const [qrIncludeWifi, setQrIncludeWifi] = useState(true);
  const [editingProductReason, setEditingProductReason] = useState("");
  const [productType, setProductType] = useState<"prepared" | "resale">("prepared");
  const [eanBarcode, setEanBarcode] = useState("");
  const [currentStockUnits, setCurrentStockUnits] = useState("");
  const [autoDeductStock, setAutoDeductStock] = useState(true);

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
    if (isNaN(qty) || qty <= 0 || costCents <= 0) return;

    const newIng: RecipeIngredient = {
      id: `ing-${Math.random()}`,
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

  // Resale Inclusion Modal State
  const [resaleModalOpen, setResaleModalOpen] = useState(false);
  const [resaleSuggestion, setResaleSuggestion] = useState<PendingStockProductSuggestion | null>(
    null,
  );
  const [resaleSalonPrice, setResaleSalonPrice] = useState("");
  const [resaleDeliveryPrice, setResaleDeliveryPrice] = useState("");
  const [resaleCategory, setResaleCategory] = useState("");
  const [resaleStation, setResaleStation] = useState("");
  const [resaleImageUrl, setResaleImageUrl] = useState("");
  const [resaleAutoDeduct, setResaleAutoDeduct] = useState(true);

  function openResaleInclusionModal(suggestion: PendingStockProductSuggestion) {
    setResaleSuggestion(suggestion);
    setResaleSalonPrice((suggestion.suggestedPriceCents / 100).toFixed(2).replace(".", ","));
    setResaleDeliveryPrice(
      Math.round((suggestion.suggestedPriceCents * 1.15) / 100)
        .toFixed(2)
        .replace(".", ","),
    );

    const cat = catalog.categories.find(
      (c) => c.name.toLowerCase() === suggestion.suggestedCategoryName.toLowerCase(),
    );
    setResaleCategory(cat ? cat.id : suggestion.suggestedCategoryName);

    const barStation = catalog.stations.find(
      (s) => s.name.toLowerCase().includes("bar") || s.name.toLowerCase().includes("bebida"),
    );
    setResaleStation(barStation ? barStation.id : catalog.stations[0]?.id || "station-1");
    setResaleImageUrl("");
    setResaleAutoDeduct(true);
    setResaleModalOpen(true);
  }

  function confirmResaleInclusion() {
    if (!resaleSuggestion) return;
    const priceCents = priceToCents(resaleSalonPrice);
    if (priceCents <= 0) {
      setFeedback("Informe um preço de venda válido.", "danger");
      return;
    }

    const cat = catalog.categories.find(
      (c) => c.id === resaleCategory || c.name.toLowerCase() === resaleCategory.toLowerCase(),
    );
    const updatedCategories = [...catalog.categories];
    let catId = cat?.id;
    if (!cat) {
      catId = slugify(resaleCategory) + Math.random();
      const newCategory = {
        id: catId,
        name: resaleCategory.trim(),
      };
      updatedCategories.push(newCategory);
    }

    const newProd: CatalogProduct = {
      id: `prod-resale-${Math.random()}`,
      categoryId: catId || "cat-default",
      sku: resaleSuggestion.sku,
      eanBarcode: resaleSuggestion.eanBarcode,
      name: resaleSuggestion.name,
      description: `Produto de revenda direta recebido do fornecedor ${resaleSuggestion.supplier}.`,
      imageUrl: resaleImageUrl.trim() || null,
      stationIds: [resaleStation || catalog.stations[0]?.id || "station-1"],
      priceCents: priceCents,
      deliveryPriceCents: resaleDeliveryPrice.trim() ? priceToCents(resaleDeliveryPrice) : null,
      costCents: resaleSuggestion.stockCostCents,
      productType: "resale",
      currentStockUnits: resaleSuggestion.currentStockUnits,
      autoDeductStock: resaleAutoDeduct,
      available: true,
      active: true,
      allergenIds: [],
      modifierGroupIds: [],
      recipe: [],
    };

    setCatalog((c) => ({
      ...c,
      categories: updatedCategories,
      products: [...c.products, newProd],
    }));

    setPendingStockSuggestions((prev) => prev.filter((s) => s.id !== resaleSuggestion.id));
    setResaleModalOpen(false);
    setResaleSuggestion(null);
    setFeedback(`"${resaleSuggestion.name}" configurado e adicionado ao cardápio com sucesso!`);
  }

  const [pendingStockSuggestions, setPendingStockSuggestions] = useState<
    PendingStockProductSuggestion[]
  >(
    scope
      ? []
      : [
          {
            id: "sug-1",
            name: "Heineken Long Neck 330ml",
            sku: "BEB-HEIN-330",
            eanBarcode: "7896045506216",
            suggestedCategoryName: "Cervejas & Chopp",
            stockCostCents: 490,
            suggestedPriceCents: 1290,
            currentStockUnits: 72,
            unit: "garrafa",
            supplier: "Distribuidora Heineken Brasil",
            receivedDate: "Hoje, 10:30 (NF 48291)",
          },
          {
            id: "sug-2",
            name: "Coca-Cola Zero 350ml (Lata)",
            sku: "BEB-COCAZ-350",
            eanBarcode: "7894900027013",
            suggestedCategoryName: "Bebidas & Refrigerantes",
            stockCostCents: 275,
            suggestedPriceCents: 750,
            currentStockUnits: 48,
            unit: "lata",
            supplier: "FEMSA Brasil",
            receivedDate: "Hoje, 09:15 (NF 93821)",
          },
          {
            id: "sug-3",
            name: "Água Mineral Crystal sem Gás 500ml",
            sku: "BEB-AGUA-500",
            eanBarcode: "7894900530018",
            suggestedCategoryName: "Bebidas & Refrigerantes",
            stockCostCents: 140,
            suggestedPriceCents: 500,
            currentStockUnits: 120,
            unit: "garrafa",
            supplier: "FEMSA Brasil",
            receivedDate: "Ontem, 16:40 (NF 93810)",
          },
        ],
  );
  const [stockInboxOpen, setStockInboxOpen] = useState(true);

  function acceptStockSuggestion(suggestion: PendingStockProductSuggestion) {
    const cat = catalog.categories.find(
      (c) => c.name.toLowerCase() === suggestion.suggestedCategoryName.toLowerCase(),
    );
    const updatedCategories = [...catalog.categories];
    let catId = cat?.id;
    if (!cat) {
      catId = slugify(suggestion.suggestedCategoryName) + Math.random();
      const newCategory = {
        id: catId,
        name: suggestion.suggestedCategoryName,
      };
      updatedCategories.push(newCategory);
    }

    const barStation = catalog.stations.find(
      (s) => s.name.toLowerCase().includes("bar") || s.name.toLowerCase().includes("bebida"),
    );
    const stationId = barStation ? barStation.id : catalog.stations[0]?.id || "station-1";

    const newProd: CatalogProduct = {
      id: `prod-resale-${Math.random()}`,
      categoryId: catId || "cat-default",
      sku: suggestion.sku,
      eanBarcode: suggestion.eanBarcode,
      name: suggestion.name,
      description: `Produto de revenda direta recebido do fornecedor ${suggestion.supplier}.`,
      imageUrl: null,
      stationIds: [stationId],
      priceCents: suggestion.suggestedPriceCents,
      costCents: suggestion.stockCostCents,
      productType: "resale",
      currentStockUnits: suggestion.currentStockUnits,
      autoDeductStock: true,
      available: true,
      active: true,
      allergenIds: [],
      modifierGroupIds: [],
      recipe: [],
    };

    setCatalog((c) => ({
      ...c,
      categories: updatedCategories,
      products: [...c.products, newProd],
    }));

    setPendingStockSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    setFeedback(
      `"${suggestion.name}" adicionado ao cardápio com estoque integrado (${suggestion.currentStockUnits} un)!`,
    );
  }

  // Bulk Resale Inclusion State
  const [bulkResaleModalOpen, setBulkResaleModalOpen] = useState(false);
  const [bulkResaleItems, setBulkResaleItems] = useState<
    Array<{
      suggestion: PendingStockProductSuggestion;
      salonPrice: string;
      deliveryPrice: string;
      category: string;
      station: string;
      autoDeduct: boolean;
      imageUrl: string;
      isExpanded: boolean;
    }>
  >([]);

  function openBulkResaleModal() {
    if (pendingStockSuggestions.length === 0) return;
    const items = pendingStockSuggestions.map((sug, idx) => {
      const cat = catalog.categories.find(
        (c) => c.name.toLowerCase() === sug.suggestedCategoryName.toLowerCase(),
      );
      const barStation = catalog.stations.find(
        (s) => s.name.toLowerCase().includes("bar") || s.name.toLowerCase().includes("bebida"),
      );
      return {
        suggestion: sug,
        salonPrice: (sug.suggestedPriceCents / 100).toFixed(2).replace(".", ","),
        deliveryPrice: Math.round((sug.suggestedPriceCents * 1.15) / 100)
          .toFixed(2)
          .replace(".", ","),
        category: cat ? cat.id : sug.suggestedCategoryName,
        station: barStation ? barStation.id : catalog.stations[0]?.id || "station-1",
        autoDeduct: true,
        imageUrl: "",
        isExpanded: idx === 0,
      };
    });
    setBulkResaleItems(items);
    setBulkResaleModalOpen(true);
  }

  function toggleBulkItemExpanded(id: string) {
    setBulkResaleItems((items) =>
      items.map((it) => (it.suggestion.id === id ? { ...it, isExpanded: !it.isExpanded } : it)),
    );
  }

  function updateBulkItem(
    id: string,
    updates: Partial<{
      salonPrice: string;
      deliveryPrice: string;
      category: string;
      station: string;
      autoDeduct: boolean;
      imageUrl: string;
      isExpanded: boolean;
    }>,
  ) {
    setBulkResaleItems((items) =>
      items.map((it) => (it.suggestion.id === id ? { ...it, ...updates } : it)),
    );
  }

  function removeBulkItem(id: string) {
    setBulkResaleItems((items) => items.filter((it) => it.suggestion.id !== id));
  }

  function confirmBulkResaleInclusion() {
    if (bulkResaleItems.length === 0) return;

    const updatedCategories = [...catalog.categories];
    const newProducts: CatalogProduct[] = [];

    for (const item of bulkResaleItems) {
      const priceCents = priceToCents(item.salonPrice);
      if (priceCents <= 0) continue;

      let cat = updatedCategories.find(
        (c) => c.id === item.category || c.name.toLowerCase() === item.category.toLowerCase(),
      );
      let catId = cat?.id;
      if (!cat) {
        catId = slugify(item.category) + Math.random();
        cat = {
          id: catId,
          name: item.category.trim(),
        };
        updatedCategories.push(cat);
      }

      newProducts.push({
        id: `prod-resale-${Math.random()}`,
        categoryId: catId || "cat-default",
        sku: item.suggestion.sku,
        eanBarcode: item.suggestion.eanBarcode,
        name: item.suggestion.name,
        description: `Produto de revenda direta recebido do fornecedor ${item.suggestion.supplier}.`,
        imageUrl: item.imageUrl.trim() || null,
        stationIds: [item.station || catalog.stations[0]?.id || "station-1"],
        priceCents: priceCents,
        deliveryPriceCents: item.deliveryPrice.trim() ? priceToCents(item.deliveryPrice) : null,
        costCents: item.suggestion.stockCostCents,
        productType: "resale",
        currentStockUnits: item.suggestion.currentStockUnits,
        autoDeductStock: item.autoDeduct,
        available: true,
        active: true,
        allergenIds: [],
        modifierGroupIds: [],
        recipe: [],
      });
    }

    setCatalog((c) => ({
      ...c,
      categories: updatedCategories,
      products: [...c.products, ...newProducts],
    }));

    const addedIds = new Set(bulkResaleItems.map((i) => i.suggestion.id));
    setPendingStockSuggestions((prev) => prev.filter((s) => !addedIds.has(s.id)));
    setBulkResaleModalOpen(false);
    setBulkResaleItems([]);
    setFeedback(`${newProducts.length} produtos de revenda adicionados com sucesso ao cardápio!`);
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("category");
    setFeedback("");
    try {
      if (scope) {
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
        return;
      }
      const newCategory = {
        id: slugify(categoryName) + Math.random(),
        name: categoryName.trim(),
        slug: slugify(categoryName),
        position: catalog.categories.length,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setCatalog((c) => ({ ...c, categories: [...c.categories, newCategory] }));
      setCategoryName("");
      setFeedback("Categoria criada.");
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
      if (scope) {
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
        setFeedback("Praça de produção criada.");
        onRetry?.();
        return;
      }
      const newStation = {
        id: slugify(stationName) + Math.random(),
        name: stationName.trim(),
        code: slugify(stationName).replace(/-/g, "_"),
      };
      setCatalog((c) => ({ ...c, stations: [...c.stations, newStation] }));
      setStationName("");
      setFeedback("Praça de produção criada.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Não foi possível criar a praça.",
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

    if (scope) {
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

    setCatalog((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.categoryId === catId ? { ...p, available: targetAvailable } : p,
      ),
    }));
    const cat = catalog.categories.find((c) => c.id === catId);
    setFeedback(
      targetAvailable
        ? `Todos os ${catProducts.length} itens de "${cat?.name || "Categoria"}" foram ativados para venda!`
        : `Todos os ${catProducts.length} itens de "${cat?.name || "Categoria"}" foram pausados temporariamente.`,
    );
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
      if (scope) {
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
        return;
      }
      setCatalog((c) => ({
        ...c,
        categories: c.categories.map((cat) => {
          if (cat.id !== editingCategory.id) return cat;
          return {
            ...cat,
            name: editingCategory.name.trim(),
            description: editingCategory.description.trim() || null,
            channels: {
              salon: editingCategory.salonChannel,
              qrMesa: editingCategory.qrMesaChannel,
              delivery: editingCategory.deliveryChannel,
            },
            schedule: editingCategory.hasSchedule
              ? {
                  startTime: editingCategory.startTime,
                  endTime: editingCategory.endTime,
                }
              : null,
            defaultStationId: editingCategory.defaultStationId || null,
          };
        }),
      }));
      setEditingCategory(null);
      setFeedback("Configurações da categoria salvas.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao atualizar categoria.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  // Dicionário culinário inteligente para tradução instantânea
  function autoTranslateProduct(name: string, description?: string | null) {
    // 1. Dicionário de Frases Culinárias Completas e Pratos Típicos (Maior prioridade)
    const phraseDict: Record<string, { en: string; es: string }> = {
      "risoto do cerrado": {
        en: "Cerrado Wild Mushroom & Baru Risotto",
        es: "Risotto del Cerrado con Setas y Barú",
      },
      "arroz arbóreo": { en: "Arborio rice", es: "Arroz arbóreo" },
      "castanha de baru": { en: "Baru nut", es: "Nuez de Barú" },
      "castanhas de baru": { en: "Baru nuts", es: "Nueces de Barú" },
      "queijo meia cura": { en: "Aged artisanal Minas cheese", es: "Queso curado artesanal" },
      "queijo canastra": { en: "Canastra artisanal cheese", es: "Queso Canastra artesanal" },
      "picanha na chapa": { en: "Sizzling Picanha Steak", es: "Picanha a la Plancha" },
      "batata frita trufada": { en: "Truffle French Fries", es: "Papas Fritas Trufadas" },
      "batata frita": { en: "French fries", es: "Papas fritas" },
      "mandioca frita": { en: "Fried cassava", es: "Yuca frita" },
      "iscas de peixe": { en: "Crispy fish bites", es: "Tiras de pescado crocantes" },
      "frutos do mar": { en: "Seafood", es: "Mariscos" },
      "leite condensado": { en: "Condensed milk", es: "Leche condensada" },
      "doce de leite": { en: "Dulce de leche", es: "Dulce de leche" },
      "ao molho madeira": { en: "with Madeira wine sauce", es: "con salsa madeira" },
      "ao molho quatro queijos": { en: "with four-cheese sauce", es: "con salsa cuatro quesos" },
      "ao molho de": { en: "with sauce of", es: "con salsa de" },
      "cebola caramelizada": { en: "caramelized onions", es: "cebolla caramelizada" },
      "pão brioche": { en: "brioche bun", es: "pan brioche" },
      "molho da casa": { en: "house special sauce", es: "salsa especial de la casa" },
      "carne de sol": { en: "Sun-dried seasoned beef", es: "Carne de sol sazonada" },
      "feijão tropeiro": {
        en: "Traditional Tropeiro beans",
        es: "Frijoles Tropeiro tradicionales",
      },
    };

    // 2. Dicionário de Vocabulário Culinário (Palavras individuais)
    const wordDict: Record<string, { en: string; es: string }> = {
      risoto: { en: "Risotto", es: "Risotto" },
      cerrado: { en: "Cerrado", es: "Cerrado" },
      arroz: { en: "Rice", es: "Arroz" },
      arboreo: { en: "Arborio", es: "Arbóreo" },
      arbóreo: { en: "Arborio", es: "Arbóreo" },
      cogumelos: { en: "Mushrooms", es: "Setas / Champiñones" },
      cogumelo: { en: "Mushroom", es: "Champiñón" },
      castanha: { en: "Nut", es: "Nuez" },
      castanhas: { en: "Nuts", es: "Nueces" },
      baru: { en: "Baru", es: "Barú" },
      hambúrguer: { en: "Burger", es: "Hamburguesa" },
      hamburguer: { en: "Burger", es: "Hamburguesa" },
      burger: { en: "Burger", es: "Hamburguesa" },
      carne: { en: "Beef", es: "Carne" },
      bife: { en: "Steak", es: "Bife / Filete" },
      frango: { en: "Chicken", es: "Pollo" },
      peixe: { en: "Fish", es: "Pescado" },
      camarão: { en: "Shrimp", es: "Camarón" },
      camarao: { en: "Shrimp", es: "Camarón" },
      salmão: { en: "Salmon", es: "Salmón" },
      costela: { en: "Ribs", es: "Costillas" },
      porco: { en: "Pork", es: "Cerdo" },
      bacon: { en: "Bacon", es: "Panceta / Tocino" },
      linguiça: { en: "Sausage", es: "Salchicha artesanal" },
      queijo: { en: "Cheese", es: "Queso" },
      parmesão: { en: "Parmesan", es: "Parmesano" },
      cheddar: { en: "Cheddar", es: "Cheddar" },
      gorgonzola: { en: "Gorgonzola", es: "Gorgonzola" },
      mozzarella: { en: "Mozzarella", es: "Mozzarella" },
      mussarela: { en: "Mozzarella", es: "Mozzarella" },
      salada: { en: "Salad", es: "Ensalada" },
      alface: { en: "Lettuce", es: "Lechuga" },
      tomate: { en: "Tomato", es: "Tomate" },
      cebola: { en: "Onion", es: "Cebolla" },
      alho: { en: "Garlic", es: "Ajo" },
      molho: { en: "Sauce", es: "Salsa" },
      azeite: { en: "Olive oil", es: "Aceite de oliva" },
      pimenta: { en: "Pepper", es: "Pimienta" },
      sobremesa: { en: "Dessert", es: "Postre" },
      pudim: { en: "Flan", es: "Flan" },
      bolo: { en: "Cake", es: "Pastel" },
      torta: { en: "Pie / Tart", es: "Tarta" },
      sorvete: { en: "Ice cream", es: "Helado" },
      chocolate: { en: "Chocolate", es: "Chocolate" },
      café: { en: "Coffee", es: "Café" },
      chopp: { en: "Draft Beer", es: "Cerveza de Barril" },
      cerveja: { en: "Beer", es: "Cerveza" },
      artesanal: { en: "Craft", es: "Artesanal" },
      suco: { en: "Juice", es: "Jugo" },
      água: { en: "Water", es: "Agua" },
      refrigerante: { en: "Soda", es: "Refresco" },
      grelhado: { en: "Grilled", es: "A la parrilla" },
      grelhada: { en: "Grilled", es: "A la parrilla" },
      assado: { en: "Roasted", es: "Asado" },
      assada: { en: "Roasted", es: "Asada" },
      frito: { en: "Fried", es: "Frito" },
      frita: { en: "Fried", es: "Frita" },
      empanado: { en: "Breaded", es: "Empanizado" },
      crocante: { en: "Crispy", es: "Crocante" },
      com: { en: "with", es: "con" },
      sem: { en: "without", es: "sin" },
      e: { en: "and", es: "y" },
      de: { en: "of", es: "de" },
      do: { en: "of", es: "del" },
      da: { en: "of", es: "de la" },
      dos: { en: "of the", es: "de los" },
      das: { en: "of the", es: "de las" },
      ao: { en: "with", es: "al" },
      à: { en: "with", es: "a la" },
    };

    function translateText(text: string, lang: "en" | "es"): string {
      if (!text || !text.trim()) return "";
      let result = text;

      // 1. Substituição de frases maiores
      for (const [ptPhrase, trans] of Object.entries(phraseDict)) {
        const regex = new RegExp(`\\b${ptPhrase}\\b`, "gi");
        result = result.replace(regex, trans[lang]);
      }

      // 2. Substituição de palavras individuais
      const tokens = result.split(/(\s+|[.,;:+/&()!?-])/);
      const translatedTokens = tokens.map((token) => {
        if (!token) return "";
        const lower = token.toLowerCase();
        const entry = wordDict[lower];
        if (entry) {
          const transWord = entry[lang];
          const firstChar = token.charAt(0);
          if (
            token.length > 0 &&
            firstChar === firstChar.toUpperCase() &&
            firstChar !== firstChar.toLowerCase()
          ) {
            return transWord.charAt(0).toUpperCase() + transWord.slice(1);
          }
          return transWord.toLowerCase();
        }
        return token;
      });

      let translated = translatedTokens.join("");
      if (lang === "en") {
        translated = translated.replace(/\\bof of\\b/gi, "of").replace(/\\bwith with\\b/gi, "with");
      }
      return translated;
    }

    const enName = translateText(name, "en") || name;
    const esName = translateText(name, "es") || name;
    const enDesc = description
      ? translateText(description, "en")
      : `Delicious ${enName.toLowerCase()} freshly prepared.`;
    const esDesc = description
      ? translateText(description, "es")
      : `Delicioso plato de ${esName.toLowerCase()} recién preparado.`;

    return {
      en: { name: enName, description: enDesc },
      es: { name: esName, description: esDesc },
    };
  }

  // Exportar Catálogo para CSV
  function exportCatalogToCsv() {
    const headers = [
      "Nome",
      "Categoria",
      "Preco_Salao",
      "Preco_Delivery",
      "Custo_CMV",
      "Descricao",
      "NCM",
      "CFOP",
      "Disponivel",
    ];
    const rows = catalog.products.map((p) => {
      const cat = catalog.categories.find((c) => c.id === p.categoryId)?.name || "Geral";
      return [
        `"${p.name.replace(/"/g, '""')}"`,
        `"${cat.replace(/"/g, '""')}"`,
        (p.priceCents / 100).toFixed(2),
        p.deliveryPriceCents ? (p.deliveryPriceCents / 100).toFixed(2) : "",
        p.costCents ? (p.costCents / 100).toFixed(2) : "",
        `"${(p.description || "").replace(/"/g, '""')}"`,
        p.ncm || "2106.90.90",
        p.cfop || "5.102",
        p.available ? "SIM" : "NAO",
      ].join(";");
    });

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `cardapio_${catalog.branding?.restaurantName ? catalog.branding.restaurantName.toLowerCase().replace(/\s+/g, "_") : "giromesa"}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setFeedback("Cardápio exportado com sucesso em CSV!");
  }

  // Baixar Modelo CSV em Branco
  function downloadCsvTemplate() {
    const headers = [
      "Nome",
      "Categoria",
      "Preco_Salao",
      "Preco_Delivery",
      "Custo_CMV",
      "Descricao",
      "NCM",
      "CFOP",
    ];
    const examples = [
      [
        '"Burger Artesanal Supreme"',
        '"Hambúrgueres"',
        "42.90",
        "48.90",
        "14.50",
        '"Blend 180g, queijo cheddar inglês e bacon."',
        "2106.90.90",
        "5.102",
      ],
      [
        '"Chopp IPA 500ml"',
        '"Bebidas & Chopes"',
        "18.00",
        "22.00",
        "5.20",
        '"Chopp artesanal lupulado fresco."',
        "2203.00.00",
        "5.102",
      ],
      [
        '"Pudim de Leite"',
        '"Sobremesas"',
        "16.50",
        "18.50",
        "4.00",
        '"Pudim cremoso com calda de caramelo."',
        "1905.90.90",
        "5.102",
      ],
    ];
    const csvContent =
      "\uFEFF" + [headers.join(";"), ...examples.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "modelo_importacao_cardapio.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Importar Itens do CSV para o Catálogo
  function handleCsvFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
        if (lines.length < 2) {
          setFeedback("Arquivo CSV vazio ou sem dados.", "danger");
          return;
        }
        const firstLine = lines[0] || "";
        const delimiter = firstLine.includes(";") ? ";" : ",";
        const parsed: Array<{
          name: string;
          category: string;
          price: number;
          deliveryPrice?: number;
          cost?: number;
          description?: string;
          ncm?: string;
        }> = [];

        for (let i = 1; i < lines.length; i++) {
          const currentLine = lines[i];
          if (!currentLine) continue;
          const cols = currentLine.split(delimiter).map((c) => c.replace(/^"|"$/g, "").trim());
          const col0 = cols[0] || "";
          const col2 = cols[2] || "";
          const col3 = cols[3] || "";
          const col4 = cols[4] || "";
          if (cols.length >= 3 && col0) {
            const price = parseFloat(col2.replace(",", ".")) || 0;
            const deliveryPrice = col3 ? parseFloat(col3.replace(",", ".")) : undefined;
            const cost = col4 ? parseFloat(col4.replace(",", ".")) : undefined;
            parsed.push({
              name: col0,
              category: cols[1] || "Geral",
              price: Math.round(price * 100),
              deliveryPrice: deliveryPrice ? Math.round(deliveryPrice * 100) : undefined,
              cost: cost ? Math.round(cost * 100) : undefined,
              description: cols[5] || "",
              ncm: cols[6] || "2106.90.90",
            });
          }
        }
        setCsvParsedPreview(parsed);
      } catch (err) {
        setFeedback("Erro ao processar o arquivo CSV. Verifique a formatação.", "danger");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // Confirmar Importação de Itens
  async function commitCsvImport() {
    if (csvParsedPreview.length === 0) return;

    if (scope) {
      const rows = csvParsedPreview.map((item) => ({
        name: item.name,
        categoryName: item.category,
        priceCents: item.price,
        deliveryPriceCents: item.deliveryPrice ?? null,
        costCents: item.cost ?? null,
        description: item.description || undefined,
        stationIds: catalog.stations[0] ? [catalog.stations[0].id] : [],
        allergenIds: [],
        modifierGroupIds: [],
        recipe: [],
        fiscal: {
          ncm: item.ncm?.replace(/\D/g, "") || undefined,
          cfop: "5102",
        },
        available: true,
      }));
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
      return;
    }

    // Garantir que categorias existam
    const currentCats = [...catalog.categories];
    const catNameToId: Record<string, string> = {};
    currentCats.forEach((c) => {
      catNameToId[c.name.toLowerCase()] = c.id;
    });

    const newCats = [...currentCats];
    csvParsedPreview.forEach((item) => {
      const lower = item.category.toLowerCase();
      if (!catNameToId[lower]) {
        const newId = `cat-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
        newCats.push({
          id: newId,
          name: item.category,
          channels: { salon: true, qrMesa: true, delivery: true },
        });
        catNameToId[lower] = newId;
      }
    });

    const newProducts: CatalogProduct[] = csvParsedPreview.map((item, idx) => ({
      id: `prod-csv-${Date.now()}-${idx}`,
      name: item.name,
      sku: null,
      imageUrl: null,
      stationIds: [],
      categoryId: catNameToId[item.category.toLowerCase()] || newCats[0]?.id || "cat-geral",
      description: item.description || null,
      priceCents: item.price,
      deliveryPriceCents: item.deliveryPrice || null,
      costCents: item.cost || null,
      ncm: item.ncm || "2106.90.90",
      cfop: "5.102",
      available: true,
      active: true,
      allergenIds: [],
      modifierGroupIds: [],
      recipe: [],
    }));

    setCatalog((c) => ({
      ...c,
      categories: newCats,
      products: [...newProducts, ...c.products],
    }));

    setCsvModalOpen(false);
    setCsvParsedPreview([]);
    setCsvFileName("");
    setFeedback(`${newProducts.length} produtos importados com sucesso da planilha!`);
  }

  // Imprimir Placas de QR Code de Mesas
  function handlePrintTableQrs() {
    if (scope) {
      const selectedRows =
        qrMode === "range"
          ? tableQrs.slice(
              Math.max(0, Math.min(qrStartTable, qrEndTable) - 1),
              Math.max(qrStartTable, qrEndTable),
            )
          : tableQrs.filter((row) =>
              qrCustomLabels
                .split(",")
                .map((label) => label.trim().toLowerCase())
                .includes(row.label.toLowerCase()),
            );
      if (selectedRows.length === 0) {
        setFeedback("Nenhuma mesa publicada corresponde à seleção.", "danger");
        return;
      }
      const printWindow = window.open("", "_blank", "width=900,height=1000");
      if (!printWindow) {
        setFeedback("Permita pop-ups no navegador para imprimir os QR Codes.", "danger");
        return;
      }
      const cards = selectedRows
        .map(
          (row) =>
            `<article><h2>${escapeHtml(row.label)}</h2><img src="${row.dataUrl}" alt="QR Code ${escapeHtml(row.label)}"><p>Aponte a câmera para abrir o cardápio e pedir.</p></article>`,
        )
        .join("");
      printWindow.document.write(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR Codes de mesas</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;display:grid;grid-template-columns:1fr 1fr;gap:12mm}article{text-align:center;border:1px solid #cbd5e1;border-radius:12px;padding:16px;break-inside:avoid}h2{margin:0 0 8px}img{width:180px;height:180px}p{font-size:12px;color:#475569}</style></head><body>${cards}<script>window.onload=()=>window.print();</script></body></html>`,
      );
      printWindow.document.close();
      setQrModalOpen(false);
      return;
    }
    let tablesToPrint: string[] = [];
    if (qrMode === "range") {
      const start = Math.min(qrStartTable, qrEndTable);
      const end = Math.max(qrStartTable, qrEndTable);
      for (let i = start; i <= end; i++) {
        tablesToPrint.push(`Mesa ${i.toString().padStart(2, "0")}`);
      }
    } else {
      tablesToPrint = qrCustomLabels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (tablesToPrint.length === 0) {
      setFeedback("Selecione ou digite ao menos uma mesa.", "danger");
      return;
    }

    const branding = catalog.branding || {
      restaurantName: "GiroMesa Bistrô",
      brandColor: "#059669",
      wifiNotice: "Wi-Fi: GiroMesa / Senha: gastronomia",
    };

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setFeedback("Permita pop-ups no navegador para imprimir os QR Codes.", "danger");
      return;
    }

    const cardsHtml = tablesToPrint
      .map((tableLabel) => {
        // Mock SVG QR Code
        const qrSvg = `
          <svg viewBox="0 0 100 100" style="width: 130px; height: 130px; margin: 0 auto; display: block;">
            <rect width="100" height="100" fill="white" />
            <!-- Outer Corners -->
            <rect x="10" y="10" width="24" height="24" fill="${branding.brandColor}" rx="4" />
            <rect x="14" y="14" width="16" height="16" fill="white" rx="2" />
            <rect x="18" y="18" width="8" height="8" fill="${branding.brandColor}" rx="1" />

            <rect x="66" y="10" width="24" height="24" fill="${branding.brandColor}" rx="4" />
            <rect x="70" y="14" width="16" height="16" fill="white" rx="2" />
            <rect x="74" y="18" width="8" height="8" fill="${branding.brandColor}" rx="1" />

            <rect x="10" y="66" width="24" height="24" fill="${branding.brandColor}" rx="4" />
            <rect x="14" y="70" width="16" height="16" fill="white" rx="2" />
            <rect x="18" y="74" width="8" height="8" fill="${branding.brandColor}" rx="1" />

            <!-- Pattern dots -->
            <circle cx="44" cy="20" r="3" fill="${branding.brandColor}" />
            <circle cx="54" cy="20" r="3" fill="${branding.brandColor}" />
            <circle cx="44" cy="30" r="3" fill="${branding.brandColor}" />
            <circle cx="20" cy="44" r="3" fill="${branding.brandColor}" />
            <circle cx="30" cy="44" r="3" fill="${branding.brandColor}" />
            <circle cx="44" cy="44" r="3.5" fill="${branding.brandColor}" />
            <circle cx="56" cy="44" r="3" fill="${branding.brandColor}" />
            <circle cx="68" cy="44" r="3" fill="${branding.brandColor}" />
            <circle cx="80" cy="44" r="3" fill="${branding.brandColor}" />
            <circle cx="44" cy="56" r="3" fill="${branding.brandColor}" />
            <circle cx="56" cy="56" r="3.5" fill="${branding.brandColor}" />
            <circle cx="68" cy="56" r="3" fill="${branding.brandColor}" />
            <circle cx="44" cy="68" r="3" fill="${branding.brandColor}" />
            <circle cx="56" cy="68" r="3" fill="${branding.brandColor}" />
            <circle cx="80" cy="68" r="3" fill="${branding.brandColor}" />
            <circle cx="44" cy="80" r="3" fill="${branding.brandColor}" />
            <circle cx="56" cy="80" r="3" fill="${branding.brandColor}" />
            <circle cx="68" cy="80" r="3" fill="${branding.brandColor}" />
            <circle cx="80" cy="80" r="3" fill="${branding.brandColor}" />
          </svg>
        `;

        return `
          <div class="qr-card">
            <div class="qr-card-header" style="background: ${branding.brandColor};">
              <div class="rest-name">${branding.restaurantName}</div>
              <div class="table-badge">${tableLabel.toUpperCase()}</div>
            </div>
            <div class="qr-card-body">
              <div class="qr-box">
                ${qrSvg}
              </div>
              <div class="scan-instructions">
                <strong>APONTE A CÂMERA DO CELULAR</strong>
                <p>Abra o cardápio digital interativo e faça seus pedidos na mesa</p>
                <small>Scan to view menu & order</small>
              </div>
            </div>
            ${
              qrIncludeWifi && branding.wifiNotice
                ? `
              <div class="qr-card-footer">
                📶 ${branding.wifiNotice}
              </div>
            `
                : ""
            }
          </div>
        `;
      })
      .join("");

    const fullHtml = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Placas QR Code de Mesas - ${branding.restaurantName}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: #f4f5f7;
            color: #111827;
          }
          .page-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15mm;
            padding: 10px;
          }
          .qr-card {
            background: #ffffff;
            border: 2px dashed #cbd5e1;
            border-radius: 14px;
            overflow: hidden;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.06);
            display: flex;
            flex-direction: column;
            page-break-inside: avoid;
            height: 125mm;
          }
          .qr-card-header {
            padding: 16px 14px;
            color: #ffffff;
          }
          .rest-name {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            opacity: 0.92;
          }
          .table-badge {
            font-size: 26px;
            font-weight: 900;
            margin-top: 4px;
            letter-spacing: 0.5px;
          }
          .qr-card-body {
            padding: 18px 14px;
            flex: 1;
            display: flex;
            flex-direction: column;
            justifyContent: center;
            align-items: center;
          }
          .qr-box {
            padding: 8px;
            background: #ffffff;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 2px 6px rgba(0,0,0,0.04);
            margin-bottom: 12px;
          }
          .scan-instructions strong {
            display: block;
            font-size: 12px;
            color: #0f172a;
            letter-spacing: 0.5px;
          }
          .scan-instructions p {
            margin: 4px 0 2px 0;
            font-size: 11px;
            color: #64748b;
          }
          .scan-instructions small {
            font-size: 9.5px;
            color: #94a3b8;
            font-style: italic;
          }
          .qr-card-footer {
            background: #f8fafc;
            padding: 8px 12px;
            font-size: 11px;
            font-weight: 600;
            color: #475569;
            border-top: 1px solid #e2e8f0;
          }
          @media print {
            body { background: transparent; }
            .page-grid { padding: 0; }
            .qr-card { box-shadow: none; }
          }
        </style>
      </head>
      <body>
        <div class="page-grid">
          ${cardsHtml}
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 400);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(fullHtml);
    printWindow.document.close();
    setQrModalOpen(false);
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
    if (isNaN(val) || val === 0) return;

    if (scope) {
      const body = {
        productIds: [],
        categoryIds:
          bulkCategory === "all"
            ? catalog.categories.map((category) => category.id)
            : [bulkCategory],
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
        setFeedback(
          error instanceof Error ? error.message : "Falha no reajuste em lote.",
          "danger",
        );
      } finally {
        setBusy("");
      }
      return;
    }

    let affectedCount = 0;
    setCatalog((c) => ({
      ...c,
      products: c.products.map((prod) => {
        if (bulkCategory !== "all" && prod.categoryId !== bulkCategory) {
          return prod;
        }
        affectedCount++;
        let newSalonPrice = prod.priceCents;
        let newDeliveryPrice = prod.deliveryPriceCents;

        if (bulkChannel === "salon" || bulkChannel === "both") {
          if (bulkType === "percentage") {
            newSalonPrice = Math.max(0, Math.round(prod.priceCents * (1 + val / 100)));
          } else {
            newSalonPrice = Math.max(0, Math.round(val * 100));
          }
        }

        if ((bulkChannel === "delivery" || bulkChannel === "both") && prod.deliveryPriceCents) {
          if (bulkType === "percentage") {
            newDeliveryPrice = Math.max(0, Math.round(prod.deliveryPriceCents * (1 + val / 100)));
          } else {
            newDeliveryPrice = Math.max(0, Math.round(val * 100));
          }
        }

        return {
          ...prod,
          priceCents: newSalonPrice,
          deliveryPriceCents: newDeliveryPrice,
        };
      }),
    }));

    setBulkModalOpen(false);
    setFeedback(`Reajuste aplicado com sucesso a ${affectedCount} produto(s).`);
  }

  async function moveCategory(id: string, direction: "up" | "down") {
    const idx = catalog.categories.findIndex((category) => category.id === id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= catalog.categories.length) return;
    const ordered = [...catalog.categories];
    [ordered[idx], ordered[targetIdx]] = [ordered[targetIdx]!, ordered[idx]!];
    if (scope) {
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
      return;
    }
    setCatalog((c) => {
      const idx = c.categories.findIndex((cat) => cat.id === id);
      if (idx === -1) return c;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= c.categories.length) return c;
      const newCats = [...c.categories];
      const temp = newCats[idx]!;
      newCats[idx] = newCats[targetIdx]!;
      newCats[targetIdx] = temp;
      return { ...c, categories: newCats };
    });
    setFeedback("Ordem das categorias atualizada.");
  }

  async function moveProduct(id: string, direction: "up" | "down") {
    const idx = catalog.products.findIndex((product) => product.id === id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= catalog.products.length) return;
    const ordered = [...catalog.products];
    [ordered[idx], ordered[targetIdx]] = [ordered[targetIdx]!, ordered[idx]!];
    if (scope) {
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
      return;
    }
    setCatalog((c) => {
      const idx = c.products.findIndex((p) => p.id === id);
      if (idx === -1) return c;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= c.products.length) return c;
      const newProds = [...c.products];
      const temp = newProds[idx]!;
      newProds[idx] = newProds[targetIdx]!;
      newProds[targetIdx] = temp;
      return { ...c, products: newProds };
    });
    setFeedback("Ordem dos produtos atualizada.");
  }

  async function quickStockOut(productId: string) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (scope && product) {
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
      return;
    }
    setCatalog((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.id === productId ? { ...p, available: false, dailyStockRemaining: 0 } : p,
      ),
    }));
    setFeedback("Item marcado como esgotado por hoje.");
  }

  async function restoreDailyStock(productId: string) {
    const product = catalog.products.find((candidate) => candidate.id === productId);
    if (scope && product) {
      setBusy(`stock-${productId}`);
      try {
        await api.pilot.setProductDailyStock(scope.organizationId, scope.unitId, productId, {
          remaining: product.dailyStockLimit ?? 20,
          autoDeductStock: product.autoDeductStock,
        });
        setFeedback("Estoque diário reabastecido.");
        onRetry?.();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Falha ao reabastecer item.",
          "danger",
        );
      } finally {
        setBusy("");
      }
      return;
    }
    setCatalog((c) => ({
      ...c,
      products: c.products.map((p) =>
        p.id === productId
          ? { ...p, available: true, dailyStockRemaining: p.dailyStockLimit ?? 20 }
          : p,
      ),
    }));
    setFeedback("Estoque diário reabastecido.");
  }

  function exportCatalogCsv() {
    const headers = [
      "ID",
      "Nome",
      "Categoria",
      "Preco_Salao_Reais",
      "Preco_Delivery_Reais",
      "Custo_Reais",
      "Disponivel",
      "Preparo_Minutos",
      "Destaques",
      "Limite_Diario",
    ];
    const rows = catalog.products.map((p) => {
      const common = [
        p.id,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${(catalog.categories.find((c) => c.id === p.categoryId)?.name || p.categoryId).replace(/"/g, '""')}"`,
        (p.priceCents / 100).toFixed(2),
      ];
      return [
        ...common,
        p.deliveryPriceCents ? (p.deliveryPriceCents / 100).toFixed(2) : "",
        p.costCents ? (p.costCents / 100).toFixed(2) : "",
        p.available ? "SIM" : "NAO",
        p.estimatedPrepTimeMinutes ?? "",
        (p.tags || []).join(";"),
        p.dailyStockLimit ?? "",
      ];
    });
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `cardapio_giromesa_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setFeedback("Cardápio exportado com sucesso em CSV.");
  }

  function importCatalogCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = (e.target?.result as string) || "";
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length <= 1) return;
        let updatedCount = 0;
        const newProducts = [...catalog.products];
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i]!.split(",");
          if (row.length < 4) continue;
          const id = row[0]?.trim();
          const priceStr = row[3]?.trim();
          const deliveryPriceStr = row[4]?.trim();
          const costStr = row[5]?.trim();
          const availableStr = row[6]?.trim();

          const prodIndex = newProducts.findIndex((p) => p.id === id);
          if (prodIndex !== -1) {
            const current = newProducts[prodIndex]!;
            const pCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : current.priceCents;
            const dCents = deliveryPriceStr
              ? Math.round(parseFloat(deliveryPriceStr) * 100)
              : current.deliveryPriceCents;
            const cCents = costStr ? Math.round(parseFloat(costStr) * 100) : current.costCents;
            const avail = availableStr ? availableStr.toUpperCase() === "SIM" : current.available;

            newProducts[prodIndex] = {
              ...current,
              priceCents: isNaN(pCents) ? current.priceCents : pCents,
              deliveryPriceCents: isNaN(dCents as number) ? current.deliveryPriceCents : dCents,
              costCents: isNaN(cCents as number) ? current.costCents : cCents,
              available: avail,
            };
            updatedCount++;
          }
        }
        if (scope) {
          const rows = newProducts
            .filter((product) => catalog.products.some((current) => current.id === product.id))
            .map((product) => ({
              productId: product.id,
              name: product.name,
              categoryId: product.categoryId,
              priceCents: product.priceCents,
              deliveryPriceCents: product.deliveryPriceCents ?? null,
              costCents: product.costCents ?? null,
              description: product.description ?? undefined,
              stationIds: normalizeCatalogStationIds(product.stationIds),
              allergenIds: product.allergenIds,
              modifierGroupIds: product.modifierGroupIds,
              recipe: product.recipe.map((ingredient) => ({
                ingredientName: ingredient.name ?? "Ingrediente",
                quantityMilli: Math.max(1, Math.round(ingredient.quantity * 1_000)),
                unit: ingredient.unit ?? "un",
                lossBasisPoints: 0,
              })),
              fiscal: {
                ncm: product.ncm?.replace(/\D/g, "") || undefined,
                cfop: product.cfop?.replace(/\D/g, "") || undefined,
              },
              available: product.available,
            }));
          setBusy("csv-import");
          await api.pilot.importCatalog(
            scope.organizationId,
            scope.unitId,
            { rows, dryRun: false },
            createAttemptKey("csv-import", rows),
          );
          completeCreateAttempt("csv-import");
          onRetry?.();
        } else {
          setCatalog((c) => ({ ...c, products: newProducts }));
        }
        setFeedback(`Importação concluída! ${updatedCount} produto(s) atualizado(s).`);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Erro ao processar CSV.", "danger");
      } finally {
        setBusy("");
      }
    };
    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  }

  async function archiveCategory(id: string) {
    if (!window.confirm("Tem certeza que deseja inativar esta categoria?")) return;
    setBusy("archive-category");
    try {
      if (scope) {
        await api.pilot.archiveCategory(scope.organizationId, scope.unitId, id);
        onRetry?.();
        return;
      }
      setCatalog((c) => ({
        ...c,
        categories: c.categories.filter((cat) => cat.id !== id),
      }));
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
      setFeedback("Selecione ao menos uma praça de produção.", "danger");
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
      const priceChanged = newPriceCents !== editingProduct.priceCents;

      const newHistoryEntry = priceChanged
        ? {
            date:
              new Date().toLocaleDateString("pt-BR") +
              " " +
              new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
            user: "Gerente Operacional",
            oldPriceCents: editingProduct.priceCents,
            newPriceCents: newPriceCents,
            reason: editingProductReason.trim() || "Ajuste operacional manual",
          }
        : null;

      if (scope) {
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
        return;
      }

      setCatalog((c) => ({
        ...c,
        products: c.products.map((p) =>
          p.id === editingProduct.id
            ? {
                ...editingProduct,
                name: editingProduct.name.trim(),
                description: editingProduct.description?.trim() || null,
                priceCents: newPriceCents,
                deliveryPriceCents: newDeliveryCents,
                priceHistory: newHistoryEntry
                  ? [newHistoryEntry, ...(p.priceHistory || [])]
                  : p.priceHistory,
              }
            : p,
        ),
      }));
      setEditingProduct(null);
      setEditingProductPrice("");
      setEditingProductDeliveryPrice("");
      setEditingProductReason("");
      setFeedback(
        priceChanged
          ? "Produto e histórico de preços atualizados!"
          : "Produto atualizado com sucesso.",
      );
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
      if (scope) {
        await api.pilot.archiveProduct(scope.organizationId, scope.unitId, id);
        onRetry?.();
        return;
      }
      setCatalog((c) => ({
        ...c,
        products: c.products.filter((p) => p.id !== id),
      }));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao inativar produto.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function toggleAvailability(product: CatalogProduct) {
    setBusy(`toggle-${product.id}`);
    try {
      if (scope) {
        await api.pilot.updateProductUnitConfig(scope.organizationId, scope.unitId, product.id, {
          priceCents: product.priceCents,
          available: !product.available,
          stationIds: normalizeCatalogStationIds(product.stationIds),
          availabilitySchedule: product.availabilitySchedule ?? null,
        });
        onRetry?.();
        return;
      }
      setCatalog((c) => ({
        ...c,
        products: c.products.map((p) =>
          p.id === product.id ? { ...p, available: !p.available } : p,
        ),
      }));
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
      if (scope) {
        await api.pilot.archiveAllergen(scope.organizationId, scope.unitId, id);
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          allergens: current.allergens.filter((allergen) => allergen.id !== id),
        }));
      }
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
      if (scope) {
        await api.pilot.archiveModifierGroup(scope.organizationId, scope.unitId, id);
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          groups: current.groups.filter((group) => group.id !== id),
          options: current.options.filter((option) => option.groupId !== id),
        }));
      }
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
      if (scope) {
        await api.pilot.archiveModifierOption(scope.organizationId, scope.unitId, id);
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          options: current.options.filter((option) => option.id !== id),
        }));
      }
      setFeedback("Opção removida.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao remover opção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function removeCombo(id: string) {
    setBusy(`combo-${id}`);
    try {
      if (scope) {
        await api.pilot.archiveCombo(scope.organizationId, scope.unitId, id);
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          combos: current.combos.filter((combo) => combo.id !== id),
        }));
      }
      setFeedback("Combo removido.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao remover combo.", "danger");
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
      if (scope) {
        await api.pilot.createModifierGroup(
          scope.organizationId,
          scope.unitId,
          body,
          createAttemptKey("manager-modifier-group", body),
        );
        completeCreateAttempt("manager-modifier-group");
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          groups: [...current.groups, { id: crypto.randomUUID(), ...body }],
        }));
      }
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
      if (scope) {
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
      } else {
        const option: ModifierOption = {
          id: crypto.randomUUID(),
          groupId: group.id,
          name,
          priceDeltaCents,
          active: true,
        };
        setCatalog((current) => ({ ...current, options: [...current.options, option] }));
      }
      setNewOptionName("");
      setNewOptionPrice("");
      setFeedback("Opção adicionada.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao adicionar opção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function savePromotion() {
    const name = promoName.trim();
    if (name.length < 2 || promoDays.length === 0) return;
    const displayValue = Number(promoValue.replace(",", "."));
    if (!Number.isFinite(displayValue) || displayValue <= 0) {
      setFeedback("Informe um desconto válido.", "danger");
      return;
    }
    const rule: Omit<CatalogPromotionRule, "id"> = {
      name,
      discountType: promoType,
      discountValue: promoType === "percentage" ? displayValue : Math.round(displayValue * 100),
      daysOfWeek: promoDays,
      startTime: promoStart,
      endTime: promoEnd,
      categoryIds: promoCategoryIds,
      productIds: promoProductIds,
      channels: { salon: promoSalon, qrMesa: promoQr, delivery: promoDelivery },
      active: true,
    };
    setBusy("promotion");
    try {
      if (scope) {
        const body = {
          name: rule.name,
          discountType: (rule.discountType === "amount_off" ? "fixed_price" : rule.discountType) as
            | "percentage"
            | "fixed_price",
          discountValue:
            rule.discountType === "percentage"
              ? Math.round(rule.discountValue * 100)
              : rule.discountValue,
          categoryIds: rule.categoryIds ?? [],
          productIds: rule.productIds ?? [],
          comboIds: [],
          channels: [
            ...(rule.channels.salon ? (["salon"] as const) : []),
            ...(rule.channels.qrMesa ? (["qr"] as const) : []),
            ...(rule.channels.delivery ? (["delivery"] as const) : []),
          ],
          daysOfWeek: rule.daysOfWeek,
          startTime: rule.startTime,
          endTime: rule.endTime,
          active: rule.active,
        };
        await api.pilot.createPromotion(
          scope.organizationId,
          scope.unitId,
          body,
          createAttemptKey("promotion", body),
        );
        completeCreateAttempt("promotion");
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          promotions: [...(current.promotions ?? []), { id: crypto.randomUUID(), ...rule }],
        }));
      }
      setPromoName("");
      setFeedback(`Campanha "${name}" criada com sucesso.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao salvar promoção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function togglePromotion(promotion: CatalogPromotionRule) {
    setBusy(`promotion-${promotion.id}`);
    try {
      if (scope) {
        await api.pilot.updatePromotion(scope.organizationId, scope.unitId, promotion.id, {
          active: !promotion.active,
        });
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          promotions: (current.promotions ?? []).map((candidate) =>
            candidate.id === promotion.id ? { ...candidate, active: !candidate.active } : candidate,
          ),
        }));
      }
      setFeedback(promotion.active ? "Campanha pausada." : "Campanha ativada.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Falha ao atualizar promoção.",
        "danger",
      );
    } finally {
      setBusy("");
    }
  }

  async function removePromotion(id: string) {
    setBusy(`promotion-${id}`);
    try {
      if (scope) {
        await api.pilot.archivePromotion(scope.organizationId, scope.unitId, id);
        onRetry?.();
      } else {
        setCatalog((current) => ({
          ...current,
          promotions: (current.promotions ?? []).filter((promotion) => promotion.id !== id),
        }));
      }
      setFeedback("Campanha removida.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao remover promoção.", "danger");
    } finally {
      setBusy("");
    }
  }

  async function saveBranding() {
    const displayName = restaurantName.trim();
    if (!displayName) {
      setFeedback("Informe o nome do estabelecimento.", "danger");
      return;
    }
    setBusy("branding");
    try {
      const persistedLogoUrl =
        scope && restaurantLogoUrl.startsWith("data:")
          ? await uploadProductImage(restaurantLogoFileName || "logo.jpg", restaurantLogoUrl)
          : restaurantLogoUrl.trim();
      if (persistedLogoUrl !== restaurantLogoUrl) {
        setRestaurantLogoUrl(persistedLogoUrl);
        setRestaurantLogoFileName("");
      }
      const branding: CatalogBrandingSettings = {
        restaurantName: displayName,
        slogan: restaurantSlogan.trim() || null,
        brandColor,
        headerBannerUrl: persistedLogoUrl || null,
        address: restaurantAddress.trim() || null,
        phone: restaurantPhone.trim() || null,
        instagram: restaurantInstagram.trim() || null,
        openingHours: restaurantOpeningHours.trim() || null,
        serviceTaxNotice: serviceTaxNotice.trim() || null,
        wifiNotice: wifiNotice.trim() || null,
        corkageFeeNotice: corkageNotice.trim() || null,
      };
      if (scope) {
        const wifiParts = wifiNotice.split("|").map((part) => part.trim());
        const ssid = (wifiParts[0] ?? "").replace(/^wi-?fi\s*:\s*/i, "").trim();
        const password = (wifiParts[1] ?? "").replace(/^senha\s*:\s*/i, "").trim();
        await api.pilot.updateBranding(scope.organizationId, scope.unitId, {
          displayName: branding.restaurantName,
          slogan: branding.slogan,
          logoUrl: persistedLogoUrl || null,
          primaryColor: branding.brandColor,
          accentColor: branding.brandColor,
          notice: null,
          address: branding.address,
          phone: branding.phone,
          instagram: branding.instagram,
          openingHours: branding.openingHours,
          serviceTaxNotice: branding.serviceTaxNotice,
          corkageFeeNotice: branding.corkageFeeNotice,
          wifi: ssid ? { ssid, password } : null,
        });
        onRetry?.();
      } else {
        setCatalog((current) => ({ ...current, branding }));
      }
      setBrandingModalOpen(false);
      setFeedback("Configurações de identidade visual salvas.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha ao salvar identidade.", "danger");
    } finally {
      setBusy("");
    }
  }

  return (
    <RemoteGate remote={remote as any}>
      {(catalog: PilotCatalog) => {
        async function createAllergen(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          if (scope) {
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
            return;
          }
          setCatalog((c) => ({
            ...c,
            allergens: [
              ...c.allergens,
              {
                id: crypto.randomUUID(),
                name: allergenName,
                code: allergenCode || slugify(allergenName),
              },
            ],
          }));
          setAllergenName("");
          setFeedback("Alergênico cadastrado.");
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
          if (scope) {
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
              setFeedback(
                error instanceof Error ? error.message : "Falha ao cadastrar grupo.",
                "danger",
              );
            } finally {
              setBusy("");
            }
            return;
          }
          setCatalog((c) => ({
            ...c,
            groups: [
              ...c.groups,
              {
                id: crypto.randomUUID(),
                name: modifierName,
                minimumSelections: modifierMin,
                maximumSelections: modifierMax,
              },
            ],
            options: [...c.options, ...options],
          }));
          setModifierName("");
          setFeedback("Grupo de adicionais criado.");
        }

        async function createCombo() {
          const priceCents = priceToCents(newComboPrice);
          const body = {
            name: newComboName.trim(),
            description: newComboDesc.trim() || undefined,
            priceCents,
            active: true,
            items: newComboProductIds.map((productId) => ({ productId, quantity: 1 })),
          };
          if (
            body.name.length < 2 ||
            newComboPrice.trim() === "" ||
            priceCents < 0 ||
            body.items.length === 0
          )
            return;

          setBusy("combo");
          setFeedback("");
          try {
            if (scope) {
              await api.pilot.createCombo(
                scope.organizationId,
                scope.unitId,
                body,
                createAttemptKey("combo", body),
              );
              completeCreateAttempt("combo");
              onRetry?.();
            } else {
              const newCombo: CatalogCombo = {
                id: crypto.randomUUID(),
                ...body,
                description: body.description ?? null,
              };
              setCatalog((current) => ({
                ...current,
                combos: [...current.combos, newCombo],
              }));
            }
            setNewComboName("");
            setNewComboDesc("");
            setNewComboPrice("");
            setNewComboProductIds([]);
            setFeedback(`Combo "${body.name}" criado com sucesso.`);
          } catch (error) {
            setFeedback(
              error instanceof Error ? error.message : "Não foi possível criar o combo.",
              "danger",
            );
          } finally {
            setBusy("");
          }
        }

        async function createProduct(event: FormEvent<HTMLFormElement>) {
          event.preventDefault();
          const selectedCategory = categoryId || catalog.categories[0]?.id;
          const priceCents = priceToCents(price);
          if (!selectedCategory || priceCents < 0) {
            setFeedback("Crie categoria e praça e informe um preço válido.", "danger");
            return;
          }
          if (!hasCatalogProductionStation(stationIds)) {
            setFeedback("Selecione ao menos uma praça de produção.", "danger");
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

            if (scope) {
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
              return;
            }

            const newProduct: CatalogProduct = {
              id: `prod-${Math.random()}`,
              sku: eanBarcode.trim() || null,
              eanBarcode: eanBarcode.trim() || null,
              productType,
              currentStockUnits: currentStockUnits.trim() ? parseInt(currentStockUnits, 10) : null,
              autoDeductStock: productType === "resale" ? autoDeductStock : undefined,
              imageUrl: imageUrl.trim() || null,
              categoryId: selectedCategory,
              name: productName.trim(),
              description: description.trim() || null,
              stationIds: normalizeCatalogStationIds(stationIds),
              estimatedPrepTimeMinutes:
                productType === "resale"
                  ? null
                  : estimatedPrepTimeMinutes === ""
                    ? null
                    : Number(estimatedPrepTimeMinutes),
              priceCents,
              deliveryPriceCents,
              costCents,
              tags: selectedTags,
              suggestedProductIds: suggestedProducts,
              availabilitySchedule: schedule,
              dailyStockLimit: stockLimit,
              dailyStockRemaining: stockLimit,
              available: true,
              active: true,
              allergenIds: selectedAllergens,
              modifierGroupIds: selectedModifiers,
              recipe: recipeIngredients,
            };
            setCatalog((c) => ({ ...c, products: [...c.products, newProduct] }));
            setProductName("");
            setDescription("");
            setPrice("");
            setDeliveryPrice("");
            setCost("");
            setImageUrl("");
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
            setFeedback("Produto criado e disponibilizado nesta unidade.");
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
            <StockInbox
              isOpen={stockInboxOpen}
              onConfigure={openResaleInclusionModal}
              onDismiss={(suggestionId) =>
                setPendingStockSuggestions((current) =>
                  current.filter((suggestion) => suggestion.id !== suggestionId),
                )
              }
              onIncludeAll={openBulkResaleModal}
              onToggle={() => setStockInboxOpen((current) => !current)}
              suggestions={pendingStockSuggestions}
            />

            {/* Modal de Importação e Exportação por Planilha CSV / Excel */}
            <Modal
              isOpen={csvModalOpen}
              onClose={() => {
                setCsvModalOpen(false);
                setCsvParsedPreview([]);
                setCsvFileName("");
              }}
              title="Importar e Exportar Cardápio por Planilha"
              size="lg"
            >
              <div className="catalog-stack catalog-stack--16">
                <p className="catalog-muted-copy-085">
                  Gerencie todo o seu catálogo em lote usando Excel ou Google Sheets. Baixe o modelo
                  pronto ou exporte seu cardápio atual com 1 clique.
                </p>

                {/* Bloco de Exportação */}
                <div className="catalog-grid-2">
                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface-soft)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <strong
                        style={{ fontSize: "0.88rem", color: "var(--gm-ink)", display: "block" }}
                      >
                        Exportar Catálogo Atual
                      </strong>
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--gm-muted)",
                          marginTop: "2px",
                          display: "block",
                        }}
                      >
                        Gera um arquivo .CSV com todos os {catalog.products.length} produtos,
                        categorias, preços e dados fiscais.
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={exportCatalogToCsv}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        alignSelf: "flex-start",
                      }}
                    >
                      <Icon name="download" size={13} />
                      <span>Baixar CSV do Cardápio</span>
                    </Button>
                  </div>

                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      background: "var(--gm-surface-soft)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                  >
                    <div>
                      <strong
                        style={{ fontSize: "0.88rem", color: "var(--gm-ink)", display: "block" }}
                      >
                        Planilha Modelo em Branco
                      </strong>
                      <span
                        style={{
                          fontSize: "0.78rem",
                          color: "var(--gm-muted)",
                          marginTop: "2px",
                          display: "block",
                        }}
                      >
                        Baixe o template com colunas padronizadas e itens de exemplo para preencher
                        no Excel.
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={downloadCsvTemplate}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        alignSelf: "flex-start",
                      }}
                    >
                      <Icon name="download" size={13} />
                      <span>Baixar Modelo (.CSV)</span>
                    </Button>
                  </div>
                </div>

                {/* Bloco de Upload */}
                <div
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    border: "2px dashed var(--gm-border)",
                    background: "var(--gm-surface)",
                    textAlign: "center",
                  }}
                >
                  <Icon name="upload" size={28} />
                  <strong
                    style={{
                      display: "block",
                      fontSize: "0.9rem",
                      color: "var(--gm-ink)",
                      marginTop: "6px",
                    }}
                  >
                    Carregar Planilha Preenchida (.CSV)
                  </strong>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--gm-muted)",
                      display: "block",
                      marginTop: "2px",
                    }}
                  >
                    Selecione o arquivo exportado do Excel ou Google Sheets (separado por vírgulas
                    ou ponto-e-vírgula).
                  </span>

                  <label
                    className="gm-button gm-button--primary gm-button--sm"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      marginTop: "12px",
                      cursor: "pointer",
                    }}
                  >
                    <Icon name="plus" size={13} />
                    <span>
                      {csvFileName ? `Arquivo: ${csvFileName}` : "Selecionar Arquivo CSV"}
                    </span>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleCsvFileUpload}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>

                {/* Pré-visualização dos Itens Lidos */}
                {csvParsedPreview.length > 0 && (
                  <div className="catalog-stack catalog-stack--8">
                    <div className="catalog-between">
                      <strong style={{ fontSize: "0.84rem", color: "var(--gm-ink)" }}>
                        Pré-visualização: {csvParsedPreview.length} produto(s) pronto(s) para
                        importar
                      </strong>
                    </div>

                    <div
                      style={{
                        maxHeight: "180px",
                        overflowY: "auto",
                        borderRadius: "8px",
                        border: "1px solid var(--gm-border)",
                        background: "var(--gm-surface)",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "0.78rem",
                          textAlign: "left",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              background: "var(--gm-surface-soft)",
                              borderBottom: "1px solid var(--gm-border)",
                              color: "var(--gm-muted)",
                            }}
                          >
                            <th className="catalog-cell-compact">Item</th>
                            <th className="catalog-cell-compact">Categoria</th>
                            <th className="catalog-cell-compact">Preço Salão</th>
                            <th className="catalog-cell-compact">Preço Delivery</th>
                            <th className="catalog-cell-compact">NCM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvParsedPreview.map((row) => (
                            <tr
                              key={`${row.name}-${row.category}-${row.price}-${row.deliveryPrice}-${row.ncm}`}
                              style={{ borderBottom: "1px solid var(--gm-border)" }}
                            >
                              <td style={{ padding: "6px 10px", fontWeight: 650 }}>{row.name}</td>
                              <td className="catalog-cell-compact">{row.category}</td>
                              <td
                                style={{
                                  padding: "6px 10px",
                                  fontWeight: 700,
                                  color: "var(--gm-brand)",
                                }}
                              >
                                {formatMoney(row.price)}
                              </td>
                              <td className="catalog-cell-compact">
                                {row.deliveryPrice ? formatMoney(row.deliveryPrice) : "—"}
                              </td>
                              <td style={{ padding: "6px 10px", color: "var(--gm-muted)" }}>
                                {row.ncm}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="catalog-modal-actions">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setCsvParsedPreview([]);
                          setCsvFileName("");
                        }}
                      >
                        Limpar
                      </Button>
                      <Button
                        disabled={busy === "csv-import"}
                        variant="primary"
                        onClick={() => void commitCsvImport()}
                      >
                        Confirmar Importação de {csvParsedPreview.length} Itens
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Modal>

            {/* Modal Gerador de Placas de QR Code para Mesas */}
            <Modal
              isOpen={qrModalOpen}
              onClose={() => setQrModalOpen(false)}
              title="Gerador de Placas & Displays de QR Code das Mesas"
              size="lg"
            >
              <div className="catalog-stack catalog-stack--16">
                <p className="catalog-muted-copy-085">
                  Gere e imprima placas de mesa de alta resolução prontas para displays de acrílico
                  ou adesivos. Cada placa possui o QR Code direto para o pedido na respectiva mesa e
                  Wi-Fi da casa.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  {/* Controles de Configuração */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <label className="catalog-field catalog-field--standard">
                      Modo de Seleção de Mesas
                      <select
                        value={qrMode}
                        onChange={(e) => setQrMode(e.target.value as any)}
                        className="catalog-control-36"
                      >
                        <option value="range">Faixa Sequencial Numérica (Ex: Mesa 1 a 20)</option>
                        <option value="custom">Nomes e Balcões Personalizados</option>
                      </select>
                    </label>

                    {qrMode === "range" ? (
                      <div className="catalog-grid-2 catalog-grid-2--compact">
                        <label className="catalog-field catalog-field--standard">
                          Mesa Inicial
                          <input
                            type="number"
                            min={1}
                            value={qrStartTable}
                            onChange={(e) => setQrStartTable(parseInt(e.target.value) || 1)}
                            className="catalog-control-36"
                          />
                        </label>
                        <label className="catalog-field catalog-field--standard">
                          Mesa Final
                          <input
                            type="number"
                            min={1}
                            value={qrEndTable}
                            onChange={(e) => setQrEndTable(parseInt(e.target.value) || 1)}
                            className="catalog-control-36"
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="catalog-field catalog-field--standard">
                        Lista de Mesas / Balcões (separados por vírgula)
                        <input
                          value={qrCustomLabels}
                          onChange={(e) => setQrCustomLabels(e.target.value)}
                          placeholder="Ex: Mesa 01, Mesa 02, Balcão 1, Deck VIP"
                          className="catalog-control-36"
                        />
                      </label>
                    )}

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "0.82rem",
                        fontWeight: 600,
                        color: "var(--gm-ink)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={qrIncludeWifi}
                        onChange={(e) => setQrIncludeWifi(e.target.checked)}
                      />
                      <span>Incluir dados do Wi-Fi no rodapé da placa</span>
                    </label>

                    <div
                      style={{
                        padding: "10px 12px",
                        background: "var(--gm-surface-sunken)",
                        borderRadius: "6px",
                        fontSize: "0.78rem",
                        color: "var(--gm-muted)",
                      }}
                    >
                      Total a imprimir:{" "}
                      <strong>
                        {qrMode === "range"
                          ? Math.max(1, qrEndTable - qrStartTable + 1)
                          : qrCustomLabels.split(",").filter(Boolean).length}{" "}
                        placa(s)
                      </strong>{" "}
                      (Diagramadas 2 por folha A4 com marcações de corte).
                    </div>
                  </div>

                  {/* Prévia da Placa da Mesa */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        color: "var(--gm-muted)",
                        marginBottom: "6px",
                      }}
                    >
                      Prévia do Display de Mesa
                    </span>
                    <div
                      style={{
                        width: "190px",
                        background: "#fff",
                        borderRadius: "12px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                        border: "1px solid var(--gm-border)",
                        overflow: "hidden",
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          background: catalog.branding?.brandColor || "#059669",
                          color: "#fff",
                          padding: "10px 8px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            opacity: 0.9,
                          }}
                        >
                          {catalog.branding?.restaurantName || "GiroMesa Bistrô"}
                        </div>
                        <div style={{ fontSize: "1.1rem", fontWeight: 900, marginTop: "2px" }}>
                          {scope && tableQrs[0]
                            ? tableQrs[0].label.toUpperCase()
                            : qrMode === "range"
                              ? `MESA ${qrStartTable.toString().padStart(2, "0")}`
                              : qrCustomLabels.split(",")[0]?.trim() || "MESA 01"}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "12px 10px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "90px",
                            height: "90px",
                            background: "#f8fafc",
                            borderRadius: "8px",
                            border: "1px solid #e2e8f0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {scope && tableQrs[0] ? (
                            <img
                              alt={`QR Code ${tableQrs[0].label}`}
                              src={tableQrs[0].dataUrl}
                              style={{ width: "88px", height: "88px" }}
                            />
                          ) : (
                            <Icon name="catalog" size={32} />
                          )}
                        </div>
                        <strong
                          style={{
                            fontSize: "0.68rem",
                            color: "#0f172a",
                            marginTop: "8px",
                            display: "block",
                          }}
                        >
                          APONTE A CÂMERA
                        </strong>
                        <span
                          style={{
                            fontSize: "0.62rem",
                            color: "#64748b",
                            display: "block",
                            lineHeight: 1.2,
                            marginTop: "2px",
                          }}
                        >
                          Peça pelo celular direto nesta mesa
                        </span>
                      </div>

                      {qrIncludeWifi && catalog.branding?.wifiNotice && (
                        <div
                          style={{
                            background: "#f1f5f9",
                            padding: "6px 8px",
                            fontSize: "0.6rem",
                            color: "#475569",
                            borderTop: "1px solid #e2e8f0",
                            fontWeight: 600,
                          }}
                        >
                          📶 {catalog.branding.wifiNotice}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="catalog-modal-actions">
                  <Button variant="ghost" onClick={() => setQrModalOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handlePrintTableQrs}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Icon name="download" size={14} />
                    <span>Imprimir Placas A4</span>
                  </Button>
                </div>
              </div>
            </Modal>

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
                  <label>
                    Nome
                    <input
                      minLength={2}
                      onChange={(event) => setCategoryName(event.target.value)}
                      required
                      value={categoryName}
                    />
                  </label>
                  <Button
                    disabled={busy === "category" || categoryName.trim().length < 2}
                    type="submit"
                  >
                    {busy === "category" ? "Salvando…" : "Criar categoria"}
                  </Button>
                </form>
              </details>
              <details className="action-panel">
                <summary>
                  <span>
                    <strong>Nova praça</strong>
                    <small>Defina onde os itens serão produzidos.</small>
                  </span>
                  <Icon name="plus" size={18} />
                </summary>
                <form className="action-form" onSubmit={(event) => void createStation(event)}>
                  <label>
                    Nome
                    <input
                      minLength={2}
                      onChange={(event) => setStationName(event.target.value)}
                      placeholder="Ex.: Cozinha quente"
                      required
                      value={stationName}
                    />
                  </label>
                  <Button
                    disabled={busy === "station" || stationName.trim().length < 2}
                    type="submit"
                  >
                    {busy === "station" ? "Salvando…" : "Criar praça"}
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
                <label>
                  Nome do Alergênico
                  <input
                    minLength={2}
                    onChange={(e) => setAllergenName(e.target.value)}
                    required
                    value={allergenName}
                    placeholder="Ex: Contém Glúten, Lactose, Frutos do Mar"
                  />
                </label>
                <Button
                  disabled={busy === "allergen" || allergenName.trim().length < 2}
                  type="submit"
                >
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
                        <button
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
                        </button>
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
                <label>
                  Nome do Grupo
                  <input
                    minLength={2}
                    onChange={(e) => setModifierName(e.target.value)}
                    required
                    value={modifierName}
                    placeholder="Ex: Ponto da Carne, Adicionais do Hambúrguer"
                  />
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <label className="catalog-grow">
                    Mínimo
                    <input
                      type="number"
                      min={0}
                      value={modifierMin}
                      onChange={(e) => setModifierMin(parseInt(e.target.value, 10) || 0)}
                    />
                  </label>
                  <label className="catalog-grow">
                    Máximo
                    <input
                      type="number"
                      min={1}
                      value={modifierMax}
                      onChange={(e) => setModifierMax(parseInt(e.target.value, 10) || 1)}
                    />
                  </label>
                </div>
                <label className="action-form__wide">
                  Opções (Nome, Preço em centavos - uma por linha)
                  <textarea
                    rows={3}
                    onChange={(e) => setModifierOptionsText(e.target.value)}
                    value={modifierOptionsText}
                    placeholder="Bacon Extra, 400&#10;Queijo Cheddar, 350&#10;Molho Especial, 0"
                  />
                </label>
                <Button
                  disabled={busy === "modifier" || modifierName.trim().length < 2}
                  type="submit"
                >
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
                        <button
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
                        </button>
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
                  <button
                    className="catalog-product-type__option"
                    data-selected={productType === "prepared" || undefined}
                    type="button"
                    onClick={() => setProductType("prepared")}
                  >
                    <Icon name="salon" size={14} />
                    <span>Produto Preparado / Cozinha</span>
                  </button>
                  <button
                    className="catalog-product-type__option"
                    data-selected={productType === "resale" || undefined}
                    type="button"
                    onClick={() => setProductType("resale")}
                  >
                    <Icon name="catalog" size={14} />
                    <span>Produto de Revenda (Bebidas / Estoque Direto)</span>
                  </button>
                </div>

                <label>
                  Nome do Produto
                  <input
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
                </label>

                {productType === "resale" && (
                  <>
                    <label>
                      Código de Barras / EAN
                      <input
                        value={eanBarcode}
                        onChange={(e) => setEanBarcode(e.target.value)}
                        placeholder="Ex: 7896045506216"
                      />
                    </label>
                    <label>
                      Estoque Físico Atual (Unidades)
                      <input
                        type="number"
                        min="0"
                        value={currentStockUnits}
                        onChange={(e) => setCurrentStockUnits(e.target.value)}
                        placeholder="Ex: 48"
                      />
                    </label>
                  </>
                )}

                <label>
                  Preço Salão (R$)
                  <input
                    inputMode="decimal"
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="0,00"
                    required
                    value={price}
                  />
                </label>
                <label>
                  Preço Delivery (Opcional)
                  <input
                    inputMode="decimal"
                    onChange={(event) => setDeliveryPrice(event.target.value)}
                    placeholder="Ex: 35,00"
                    value={deliveryPrice}
                  />
                </label>
                <label>
                  {productType === "resale"
                    ? "Custo de Compra Unitário (R$)"
                    : "Custo Unitário / Insumos (R$)"}
                  <input
                    inputMode="decimal"
                    onChange={(event) => setCost(event.target.value)}
                    placeholder="Ex: 8,50"
                    value={cost}
                  />
                </label>
                <label>
                  Categoria
                  <select
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
                  </select>
                </label>

                {/* Praças de produção */}
                <div className="action-form__wide catalog-create-stations">
                  <span className="catalog-text-strong-078">Praças de produção</span>
                  <small className="catalog-create-stations__help">
                    Cada praça selecionada recebe o item e todas precisam concluir. Selecione ao
                    menos uma.
                  </small>
                  <div className="catalog-create-stations__options">
                    {catalog.stations.map((item) => {
                      const selected = stationIds.includes(item.id);
                      return (
                        <button
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
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="action-form__wide">
                  Descrição do Prato / Item
                  <textarea
                    onChange={(event) => setDescription(event.target.value)}
                    rows={2}
                    placeholder="Descreva os ingredientes principais, sabor e apresentação do prato..."
                    value={description}
                  />
                </label>

                <label className="action-form__wide">
                  Foto do Prato (Opcional)
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (
                        !(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)
                      ) {
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
                      reader.onerror = () =>
                        setFeedback("Não foi possível ler a imagem.", "danger");
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
                </label>

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
                                  <strong className="catalog-ink">
                                    {formatMoney(ing.costCents)}
                                  </strong>
                                  <button
                                    type="button"
                                    className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                                    style={{ width: "24px", height: "24px" }}
                                    onClick={() => removeIngredient(ing.id)}
                                    title="Remover insumo"
                                  >
                                    <Icon name="x" size={11} />
                                  </button>
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
                          <input
                            placeholder="Insumo (ex: Filé Mignon)"
                            value={ingName}
                            onChange={(e) => setIngName(e.target.value)}
                            className="catalog-input-compact"
                          />
                          <input
                            type="number"
                            min="0.1"
                            step="any"
                            placeholder="Qtd (200)"
                            value={ingQty}
                            onChange={(e) => setIngQty(e.target.value)}
                            className="catalog-input-compact"
                          />
                          <select
                            value={ingUnit}
                            onChange={(e) => setIngUnit(e.target.value as any)}
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
                          </select>
                          <input
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
                            const totalCostCents = recipeIngredients.reduce(
                              (a, b) => a + b.costCents,
                              0,
                            );
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
                                      <button
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
                                            targetMarkup === m
                                              ? "var(--gm-brand)"
                                              : "var(--gm-surface)",
                                          color: targetMarkup === m ? "#fff" : "var(--gm-ink)",
                                        }}
                                      >
                                        {m.toFixed(1)}x
                                      </button>
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
                                  <button
                                    type="button"
                                    className="catalog-card-btn catalog-card-btn--active"
                                    style={{ height: "26px", fontSize: "0.74rem" }}
                                    onClick={() => applySuggestedMarkupPrice(totalCostCents)}
                                  >
                                    <Icon name="check" size={12} />
                                    <span>Usar no Preço</span>
                                  </button>
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
                        <span
                          style={{ fontSize: "0.74rem", color: "var(--gm-brand)", fontWeight: 700 }}
                        >
                          Configurado
                        </span>
                      )}
                    </summary>
                    <div className="catalog-sub-accordion__content">
                      <div className="catalog-grid-2">
                        <label style={{ margin: 0 }}>
                          Tempo de Preparo Estimado (min)
                          <input
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
                        </label>
                        <label style={{ margin: 0 }}>
                          Limite Diário de Porções (Opcional)
                          <input
                            type="number"
                            min="1"
                            onChange={(event) => setDailyStockLimit(event.target.value)}
                            value={dailyStockLimit}
                            placeholder="Ex: 25 porções/dia"
                          />
                        </label>
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
                          <label className="catalog-small-copy">
                            Início
                            <input
                              type="time"
                              value={scheduleStart}
                              onChange={(e) => setScheduleStart(e.target.value)}
                              style={{
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: "1px solid var(--gm-border)",
                              }}
                            />
                          </label>
                          <label className="catalog-small-copy">
                            Término
                            <input
                              type="time"
                              value={scheduleEnd}
                              onChange={(e) => setScheduleEnd(e.target.value)}
                              style={{
                                padding: "6px 8px",
                                borderRadius: "6px",
                                border: "1px solid var(--gm-border)",
                              }}
                            />
                          </label>
                          <label className="catalog-small-copy">
                            Dias
                            <select
                              value={scheduleDays}
                              onChange={(e) => setScheduleDays(e.target.value as any)}
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
                            </select>
                          </label>
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
                        <div className="catalog-toolbar-wrap">
                          {catalog.allergens.map((alg) => {
                            const selected = selectedAllergens.includes(alg.id);
                            return (
                              <button
                                key={alg.id}
                                type="button"
                                onClick={() => {
                                  if (selected)
                                    setSelectedAllergens(
                                      selectedAllergens.filter((id) => id !== alg.id),
                                    );
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
                                  border: selected
                                    ? "1.5px solid #ef4444"
                                    : "1px solid var(--gm-border)",
                                  background: selected
                                    ? "rgba(239, 68, 68, 0.1)"
                                    : "var(--gm-surface)",
                                  color: selected ? "#dc2626" : "var(--gm-ink)",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Icon name="alert-circle" size={13} />
                                <span>{alg.name}</span>
                              </button>
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
                        <div className="catalog-toolbar-wrap">
                          {catalog.groups.map((grp) => {
                            const selected = selectedModifiers.includes(grp.id);
                            return (
                              <button
                                key={grp.id}
                                type="button"
                                onClick={() => {
                                  if (selected)
                                    setSelectedModifiers(
                                      selectedModifiers.filter((id) => id !== grp.id),
                                    );
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
                                  border: selected
                                    ? "1.5px solid #10b981"
                                    : "1px solid var(--gm-border)",
                                  background: selected
                                    ? "rgba(16, 185, 129, 0.1)"
                                    : "var(--gm-surface)",
                                  color: selected ? "#059669" : "var(--gm-ink)",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <Icon name="plus" size={13} />
                                <span>{grp.name}</span>
                              </button>
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
                      {productNcm && (
                        <span className="catalog-text-positive">NCM: {productNcm}</span>
                      )}
                    </summary>
                    <div className="catalog-sub-accordion__content">
                      <div className="catalog-grid-main">
                        <label className="catalog-field catalog-field--compact">
                          NCM (Nomenclatura Comum do Mercosul)
                          <input
                            value={productNcm}
                            onChange={(e) => setProductNcm(e.target.value)}
                            placeholder="Ex: 2106.90.90"
                            className="catalog-control-34"
                          />
                        </label>
                        <label className="catalog-field catalog-field--compact">
                          CFOP Padrão
                          <select
                            value={productCfop}
                            onChange={(e) => setProductCfop(e.target.value)}
                            className="catalog-control-34"
                          >
                            <option value="5.102">5.102 - Revenda de Mercadoria</option>
                            <option value="5.101">5.101 - Produção do Estabelecimento</option>
                            <option value="5.405">5.405 - Venda com Subst. Tributária</option>
                          </select>
                        </label>
                      </div>

                      <div
                        style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}
                      >
                        <span className="catalog-muted-072">Atalhos Rápidos de NCM:</span>
                        {[
                          { label: "Pratos & Lanches (2106.90.90)", code: "2106.90.90" },
                          { label: "Chopes & Cervejas (2203.00.00)", code: "2203.00.00" },
                          { label: "Refrigerantes & Sucos (2202.10.00)", code: "2202.10.00" },
                          { label: "Sobremesas & Doces (1905.90.90)", code: "1905.90.90" },
                        ].map((preset) => (
                          <button
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
                          </button>
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
                        <span
                          style={{ fontSize: "0.74rem", color: "var(--gm-brand)", fontWeight: 700 }}
                        >
                          {selectedTags.length + suggestedProducts.length} ativo(s)
                        </span>
                      )}
                    </summary>
                    <div className="catalog-sub-accordion__content">
                      <div className="catalog-stack catalog-stack--6">
                        <span className="catalog-text-strong-078">Destaques e Selos de Venda</span>
                        <div className="catalog-toolbar-wrap">
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
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => {
                                  if (selected)
                                    setSelectedTags(selectedTags.filter((t) => t !== tag.id));
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
                              </button>
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
                                <button
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
                                </button>
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
                    (Boolean(scope) && stationIds.length === 0)
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
              categoryCount={catalog.categories.length}
              comboCount={catalog.combos.length}
              groupCount={catalog.groups.length}
              language={catalogLanguage}
              onExportCsv={exportCatalogCsv}
              onImportCsv={importCatalogCsv}
              onLanguageChange={setCatalogLanguage}
              onOpenBranding={() => setBrandingModalOpen(true)}
              onOpenBulkAdjustment={() => setBulkModalOpen(true)}
              onOpenCustomerPreview={() => void openCustomerPreview()}
              onOpenLabels={() => setPrintableLabelsModalOpen(true)}
              onOpenMatrix={() => void openBcgMatrix()}
              onOpenModifiers={() => setModifiersManagerModalOpen(true)}
              onOpenPdf={() => setPdfExportModalOpen(true)}
              onOpenPromotions={() => setPromosAndCombosModalOpen(true)}
              onOpenQrGenerator={() => void openQrGenerator()}
              onOpenReorder={() => setReorderModalOpen(true)}
              onOpenSpreadsheet={() => setCsvModalOpen(true)}
              productCount={catalog.products.length}
              production={Boolean(scope)}
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
              production={Boolean(scope)}
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

                  <label className="catalog-field catalog-field--medium">
                    Categoria Alvo
                    <select
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                      className="catalog-control-padded"
                    >
                      <option value="all">
                        Todas as Categorias ({catalog.products.length} itens)
                      </option>
                      {catalog.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({catalog.products.filter((p) => p.categoryId === c.id).length}{" "}
                          itens)
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="catalog-field catalog-field--medium">
                    Canal de Venda
                    <select
                      value={bulkChannel}
                      onChange={(e) => setBulkChannel(e.target.value as any)}
                      className="catalog-control-padded"
                    >
                      <option value="both">Salão e Delivery</option>
                      <option value="salon">Apenas Preço do Salão</option>
                      <option value="delivery">Apenas Preço do Delivery</option>
                    </select>
                  </label>

                  <div className="catalog-grid-2">
                    <label className="catalog-field catalog-field--medium">
                      Tipo de Ajuste
                      <select
                        value={bulkType}
                        onChange={(e) => setBulkType(e.target.value as any)}
                        className="catalog-control-padded"
                      >
                        <option value="percentage">Percentual (%)</option>
                        <option value="fixed">Definir preço final (R$)</option>
                      </select>
                    </label>

                    <label className="catalog-field catalog-field--medium">
                      Valor do Ajuste
                      <input
                        type="number"
                        step="any"
                        value={bulkValue}
                        onChange={(e) => setBulkValue(e.target.value)}
                        placeholder={bulkType === "percentage" ? "Ex: 10 para +10%" : "Ex: 2.50"}
                        className="catalog-control-padded"
                      />
                    </label>
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
              production={Boolean(scope)}
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
                <form
                  onSubmit={(event) => void updateCategory(event)}
                  className="catalog-form-stack"
                >
                  {/* Nome da Categoria */}
                  <label
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
                    <input
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
                  </label>

                  {
                    <>
                      {/* Subtítulo / Descrição da Categoria */}
                      <label
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
                        <textarea
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
                        <span
                          style={{ fontSize: "0.74rem", color: "var(--gm-muted)", fontWeight: 400 }}
                        >
                          Texto exibido abaixo do título da categoria no cardápio digital do
                          cliente.
                        </span>
                      </label>

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
                          <button
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
                          </button>

                          <button
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
                                color: editingCategory.qrMesaChannel
                                  ? "#10b981"
                                  : "var(--gm-muted)",
                                fontWeight: 700,
                              }}
                            >
                              {editingCategory.qrMesaChannel ? "✓ Ativo" : "✕ Oculto"}
                            </span>
                          </button>

                          <button
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
                                color: editingCategory.deliveryChannel
                                  ? "#10b981"
                                  : "var(--gm-muted)",
                                fontWeight: 700,
                              }}
                            >
                              {editingCategory.deliveryChannel ? "✓ Ativo" : "✕ Oculto"}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Praça de Produção Padrão */}
                      <label
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          fontSize: "0.84rem",
                          fontWeight: 700,
                          color: "var(--gm-ink)",
                        }}
                      >
                        Praça de Produção Padrão para Novos Itens
                        <select
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
                          <option value="">Nenhuma praça fixa (definir individualmente)</option>
                          {catalog.stations.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      {/* Programação por Horário */}
                      <div
                        style={{
                          border: "1px solid var(--gm-border)",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          background: "var(--gm-surface-soft)",
                        }}
                      >
                        <label
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
                        </label>

                        {editingCategory.hasSchedule ? (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "10px",
                              marginTop: "10px",
                            }}
                          >
                            <label
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
                              <input
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
                            </label>
                            <label
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
                              <input
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
                            </label>
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
                      disabled={
                        busy === "update-category" || editingCategory.name.trim().length < 2
                      }
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
                    Ajuste a ordem em que as categorias e seus produtos aparecem para a sua equipe e
                    no cardápio dos clientes.
                  </p>

                  <div className="catalog-stack catalog-stack--8">
                    {catalog.categories.map((cat, idx) => {
                      const prodCount = catalog.products.filter(
                        (p) => p.categoryId === cat.id,
                      ).length;
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
              production={Boolean(scope)}
              setEditingProduct={setEditingProduct}
              setEditingProductDeliveryPrice={setEditingProductDeliveryPrice}
              setEditingProductPrice={setEditingProductPrice}
              setEditingProductReason={setEditingProductReason}
              uploadProductImage={uploadProductImage}
              updateProduct={updateProduct}
            />

            {/* Modal: Matriz de Engenharia de Cardápio (BCG) */}
            {matrixModalOpen && (
              <Modal
                isOpen={matrixModalOpen}
                title="Matriz de Engenharia de Cardápio (Menu Engineering Matrix)"
                onClose={() => setMatrixModalOpen(false)}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    maxWidth: "800px",
                  }}
                >
                  <p className="catalog-muted-copy-085">
                    Classificação estratégica dos pratos baseada no cruzamento de{" "}
                    <strong>Margem de Lucro</strong> e <strong>Popularidade de Vendas</strong>.
                  </p>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "14px",
                    }}
                  >
                    {/* Quadrante 1: Estrelas */}
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: "1.5px solid #10b981",
                        background: "rgba(16, 185, 129, 0.04)",
                      }}
                    >
                      <div className="catalog-between catalog-between--mb8">
                        <strong
                          style={{
                            color: "#059669",
                            fontSize: "0.92rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Icon name="check" size={16} /> Estrelas (Stars)
                        </strong>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            background: "rgba(16, 185, 129, 0.2)",
                            color: "#059669",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            fontWeight: 700,
                          }}
                        >
                          Alta Margem + Alta Venda
                        </span>
                      </div>
                      <p className="catalog-muted-copy-tight">
                        Estratégia: Manter consistência, posicionar no topo do cardápio e não
                        alterar receitas.
                      </p>
                      <div className="catalog-stack catalog-stack--6">
                        {catalog.products
                          .filter((p) => {
                            if (scope) return bcgByProductId.get(p.id)?.quadrant === "star";
                            const margin = p.costCents
                              ? ((p.priceCents - p.costCents) / p.priceCents) * 100
                              : 50;
                            const isPop =
                              p.tags?.includes("bestseller") ||
                              p.tags?.includes("chef_special") ||
                              p.priceCents <= 3500;
                            return margin >= 55 && isPop;
                          })
                          .map((p) => (
                            <div key={p.id} className="catalog-summary-row">
                              <span>{p.name}</span>
                              <strong>{formatMoney(p.priceCents)}</strong>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Quadrante 2: Quebra-Cabeças */}
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: "1.5px solid #3b82f6",
                        background: "rgba(59, 130, 246, 0.04)",
                      }}
                    >
                      <div className="catalog-between catalog-between--mb8">
                        <strong
                          style={{
                            color: "#2563eb",
                            fontSize: "0.92rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Icon name="catalog" size={16} /> Quebra-Cabeças (Puzzles)
                        </strong>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            background: "rgba(59, 130, 246, 0.2)",
                            color: "#2563eb",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            fontWeight: 700,
                          }}
                        >
                          Alta Margem + Baixa Venda
                        </span>
                      </div>
                      <p className="catalog-muted-copy-tight">
                        Estratégia: Adicionar fotos atraentes, treinar garçons para venda sugerida e
                        destacar como sugestão do chef.
                      </p>
                      <div className="catalog-stack catalog-stack--6">
                        {catalog.products
                          .filter((p) => {
                            if (scope) return bcgByProductId.get(p.id)?.quadrant === "opportunity";
                            const margin = p.costCents
                              ? ((p.priceCents - p.costCents) / p.priceCents) * 100
                              : 50;
                            const isPop =
                              p.tags?.includes("bestseller") ||
                              p.tags?.includes("chef_special") ||
                              p.priceCents <= 3500;
                            return margin >= 55 && !isPop;
                          })
                          .map((p) => (
                            <div key={p.id} className="catalog-summary-row">
                              <span>{p.name}</span>
                              <strong>{formatMoney(p.priceCents)}</strong>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Quadrante 3: Burros de Carga */}
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: "1.5px solid #f59e0b",
                        background: "rgba(245, 158, 11, 0.04)",
                      }}
                    >
                      <div className="catalog-between catalog-between--mb8">
                        <strong
                          style={{
                            color: "#d97706",
                            fontSize: "0.92rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Icon name="clock" size={16} /> Burros de Carga (Plowhorses)
                        </strong>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            background: "rgba(245, 158, 11, 0.2)",
                            color: "#d97706",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            fontWeight: 700,
                          }}
                        >
                          Baixa Margem + Alta Venda
                        </span>
                      </div>
                      <p className="catalog-muted-copy-tight">
                        Estratégia: Reajustar ligeiramente o preço (+5%), renegociar insumos com
                        fornecedores ou ajustar porções.
                      </p>
                      <div className="catalog-stack catalog-stack--6">
                        {catalog.products
                          .filter((p) => {
                            if (scope) return bcgByProductId.get(p.id)?.quadrant === "volume";
                            const margin = p.costCents
                              ? ((p.priceCents - p.costCents) / p.priceCents) * 100
                              : 50;
                            const isPop =
                              p.tags?.includes("bestseller") ||
                              p.tags?.includes("chef_special") ||
                              p.priceCents <= 3500;
                            return margin < 55 && isPop;
                          })
                          .map((p) => (
                            <div key={p.id} className="catalog-summary-row">
                              <span>{p.name}</span>
                              <strong>{formatMoney(p.priceCents)}</strong>
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Quadrante 4: Cães */}
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "10px",
                        border: "1.5px solid #ef4444",
                        background: "rgba(239, 68, 68, 0.04)",
                      }}
                    >
                      <div className="catalog-between catalog-between--mb8">
                        <strong
                          style={{
                            color: "#dc2626",
                            fontSize: "0.92rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Icon name="alerts" size={16} /> Cães (Dogs)
                        </strong>
                        <span
                          style={{
                            fontSize: "0.72rem",
                            background: "rgba(239, 68, 68, 0.2)",
                            color: "#dc2626",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            fontWeight: 700,
                          }}
                        >
                          Baixa Margem + Baixa Venda
                        </span>
                      </div>
                      <p className="catalog-muted-copy-tight">
                        Estratégia: Avaliar remoção do cardápio ou reformular completamente o prato
                        para reduzir desperdício de insumos.
                      </p>
                      <div className="catalog-stack catalog-stack--6">
                        {catalog.products
                          .filter((p) => {
                            if (scope) return bcgByProductId.get(p.id)?.quadrant === "dog";
                            const margin = p.costCents
                              ? ((p.priceCents - p.costCents) / p.priceCents) * 100
                              : 50;
                            const isPop =
                              p.tags?.includes("bestseller") ||
                              p.tags?.includes("chef_special") ||
                              p.priceCents <= 3500;
                            return margin < 55 && !isPop;
                          })
                          .map((p) => (
                            <div key={p.id} className="catalog-summary-row">
                              <span>{p.name}</span>
                              <strong>{formatMoney(p.priceCents)}</strong>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div className="catalog-actions-end">
                    <Button variant="primary" onClick={() => setMatrixModalOpen(false)}>
                      Fechar Análise
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

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
                          {scope && tableQrs[selectedQrTable]
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
                                    <button
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
                                    </button>
                                  )}
                                  {qty > 0 && (
                                    <span style={{ fontSize: "0.75rem", fontWeight: 700 }}>
                                      {qty}
                                    </span>
                                  )}
                                  <button
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
                                  </button>
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
                      {scope && publication && (
                        <div className="gm-observability-row">
                          <span className="gm-pill" data-tone="positive">
                            Publicado · versão {publication.version}
                          </span>
                        </div>
                      )}
                      <label
                        style={{
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          display: "block",
                          marginBottom: "8px",
                        }}
                      >
                        Selecione a Mesa para Gerar o QR Code
                        <select
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
                          {scope
                            ? tableQrs.map((row, index) => (
                                <option key={row.tableId} value={index}>
                                  {row.label}
                                </option>
                              ))
                            : Array.from({ length: 20 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>
                                  Mesa {m}
                                </option>
                              ))}
                        </select>
                      </label>

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
                        {scope && tableQrs[selectedQrTable] ? (
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
                          {scope && tableQrs[selectedQrTable]
                            ? tableQrs[selectedQrTable].label.toUpperCase()
                            : `MESA #${selectedQrTable}`}
                        </span>
                      </div>

                      <Button
                        variant="primary"
                        onClick={handlePrintTableQrs}
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
                              {catalog.categories.find((c) => c.id === p.categoryId)?.name ||
                                "Prato"}
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
                                <span
                                  style={{ fontSize: "0.65rem", color: "#dc2626", fontWeight: 700 }}
                                >
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
            {resaleModalOpen && resaleSuggestion && (
              <Modal
                isOpen={resaleModalOpen}
                size="lg"
                title={`Incluir no Cardápio: ${resaleSuggestion.name}`}
                onClose={() => {
                  setResaleModalOpen(false);
                  setResaleSuggestion(null);
                }}
              >
                <div className="catalog-stack catalog-stack--16">
                  {/* Banner de Dados do Estoque */}
                  <div
                    style={{
                      background: "rgba(37, 99, 235, 0.06)",
                      border: "1px solid rgba(37, 99, 235, 0.2)",
                      borderRadius: "8px",
                      padding: "12px 14px",
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "10px",
                      fontSize: "0.82rem",
                    }}
                  >
                    <div>
                      <span
                        style={{ color: "var(--gm-muted)", fontSize: "0.72rem", display: "block" }}
                      >
                        FORNECEDOR & ORIGEM
                      </span>
                      <strong className="catalog-ink">{resaleSuggestion.supplier}</strong>
                      <div
                        style={{ color: "var(--gm-muted)", fontSize: "0.72rem", marginTop: "2px" }}
                      >
                        {resaleSuggestion.receivedDate}
                      </div>
                    </div>
                    <div>
                      <span
                        style={{ color: "var(--gm-muted)", fontSize: "0.72rem", display: "block" }}
                      >
                        CÓDIGO EAN / ESTOQUE DISPONÍVEL
                      </span>
                      <strong className="catalog-ink">EAN {resaleSuggestion.eanBarcode}</strong>
                      <div
                        style={{
                          color: "#059669",
                          fontWeight: 700,
                          fontSize: "0.75rem",
                          marginTop: "2px",
                        }}
                      >
                        {resaleSuggestion.currentStockUnits} {resaleSuggestion.unit}s no estoque
                      </div>
                    </div>
                  </div>

                  {/* Form de Ajuste de Preço e Categoria */}
                  <div className="catalog-grid-2">
                    <div>
                      <label
                        htmlFor="resale-stock-cost"
                        className="catalog-label-block catalog-label-block--078"
                      >
                        Custo de Compra (Estoque)
                      </label>
                      <input
                        disabled
                        id="resale-stock-cost"
                        value={formatMoney(resaleSuggestion.stockCostCents)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--gm-border)",
                          background: "var(--gm-surface-sunken)",
                          color: "var(--gm-ink)",
                          fontWeight: 700,
                        }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="resale-salon-price"
                        className="catalog-label-block catalog-label-block--078"
                      >
                        Preço Salão (R$) *
                      </label>
                      <input
                        id="resale-salon-price"
                        inputMode="decimal"
                        value={resaleSalonPrice}
                        onChange={(e) => setResaleSalonPrice(e.target.value)}
                        placeholder="0,00"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1.5px solid var(--gm-brand)",
                          fontWeight: 750,
                          fontSize: "0.95rem",
                          color: "var(--gm-ink)",
                        }}
                      />
                    </div>
                  </div>

                  {/* Realtime Margin preview */}
                  {priceToCents(resaleSalonPrice) > 0 &&
                    (() => {
                      const priceCents = priceToCents(resaleSalonPrice);
                      const costCents = resaleSuggestion.stockCostCents;
                      const profit = priceCents - costCents;
                      const margin = Math.round((profit / priceCents) * 100);
                      const markup = (priceCents / costCents).toFixed(2);
                      return (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "8px 12px",
                            background:
                              margin >= 50
                                ? "rgba(16, 185, 129, 0.08)"
                                : "rgba(245, 158, 11, 0.08)",
                            border: `1px solid ${margin >= 50 ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.25)"}`,
                            borderRadius: "6px",
                            fontSize: "0.8rem",
                          }}
                        >
                          <span>
                            Lucro Bruto: <strong>{formatMoney(profit)}</strong>
                          </span>
                          <span>
                            Margem:{" "}
                            <strong style={{ color: margin >= 50 ? "#059669" : "#d97706" }}>
                              {margin}%
                            </strong>
                          </span>
                          <span>
                            Markup: <strong>{markup}x</strong>
                          </span>
                        </div>
                      );
                    })()}

                  <div className="catalog-grid-2">
                    <div>
                      <label
                        htmlFor="resale-delivery-price"
                        className="catalog-label-block catalog-label-block--078"
                      >
                        Preço Delivery (Opcional)
                      </label>
                      <input
                        id="resale-delivery-price"
                        inputMode="decimal"
                        value={resaleDeliveryPrice}
                        onChange={(e) => setResaleDeliveryPrice(e.target.value)}
                        placeholder="Ex: 14,90"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--gm-border)",
                        }}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="resale-category"
                        className="catalog-label-block catalog-label-block--078"
                      >
                        Categoria de Exibição
                      </label>
                      <select
                        id="resale-category"
                        value={resaleCategory}
                        onChange={(e) => setResaleCategory(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--gm-border)",
                          background: "var(--gm-surface)",
                          color: "var(--gm-ink)",
                        }}
                      >
                        {catalog.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                        <option value={resaleSuggestion.suggestedCategoryName}>
                          + Criar Categoria "{resaleSuggestion.suggestedCategoryName}"
                        </option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="resale-station"
                      className="catalog-label-block catalog-label-block--078"
                    >
                      Praça de Atendimento / Saída
                    </label>
                    <select
                      id="resale-station"
                      value={resaleStation}
                      onChange={(e) => setResaleStation(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--gm-border)",
                        background: "var(--gm-surface)",
                        color: "var(--gm-ink)",
                      }}
                    >
                      {catalog.stations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Foto Upload */}
                  <div>
                    <label
                      htmlFor="resale-image"
                      className="catalog-label-block catalog-label-block--078"
                    >
                      Foto do Produto (Opcional)
                    </label>
                    <input
                      id="resale-image"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
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
                              setResaleImageUrl(canvas.toDataURL("image/jpeg", 0.7));
                            }
                          };
                          img.src = e.target?.result as string;
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    {resaleImageUrl && (
                      <img
                        src={resaleImageUrl}
                        alt="Preview"
                        style={{
                          marginTop: "6px",
                          maxHeight: "80px",
                          borderRadius: "6px",
                          objectFit: "cover",
                        }}
                      />
                    )}
                  </div>

                  {/* Baixa Automática Checkbox */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: "var(--gm-surface-sunken)",
                      border: "1px solid var(--gm-border)",
                    }}
                  >
                    <input
                      type="checkbox"
                      id="modal-auto-deduct"
                      checked={resaleAutoDeduct}
                      onChange={(e) => setResaleAutoDeduct(e.target.checked)}
                      style={{ width: "16px", height: "16px", cursor: "pointer" }}
                    />
                    <label
                      htmlFor="modal-auto-deduct"
                      style={{
                        margin: 0,
                        fontSize: "0.82rem",
                        fontWeight: 650,
                        color: "var(--gm-ink)",
                        cursor: "pointer",
                      }}
                    >
                      Habilitar baixa automática 1-para-1 no estoque na venda deste item
                    </label>
                  </div>

                  {/* Footer actions */}
                  <div className="catalog-modal-actions">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setResaleModalOpen(false);
                        setResaleSuggestion(null);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      variant="primary"
                      onClick={confirmResaleInclusion}
                      disabled={priceToCents(resaleSalonPrice) <= 0}
                    >
                      <Icon name="check" size={14} />
                      <span>Publicar no Cardápio</span>
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

            {/* Modal de Configuração em Lote de Produtos de Revenda (Inbox do Estoque) */}
            {bulkResaleModalOpen && (
              <Modal
                isOpen={bulkResaleModalOpen}
                size="lg"
                title={`Entrada em Lote do Estoque (${bulkResaleItems.length} Produtos)`}
                onClose={() => {
                  setBulkResaleModalOpen(false);
                  setBulkResaleItems([]);
                }}
              >
                <div className="catalog-stack catalog-stack--14">
                  <p className="catalog-muted-copy-084">
                    Personalize os preços de venda, categorias, fotos e regras de baixa de cada
                    produto recebido antes de publicá-los no cardápio.
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {bulkResaleItems.map((item) => {
                      const priceCents = priceToCents(item.salonPrice);
                      const costCents = item.suggestion.stockCostCents;
                      const profit = priceCents > 0 ? priceCents - costCents : 0;
                      const margin = priceCents > 0 ? Math.round((profit / priceCents) * 100) : 0;
                      const markup =
                        costCents > 0 && priceCents > 0
                          ? (priceCents / costCents).toFixed(2)
                          : "0.00";

                      return (
                        <div
                          key={item.suggestion.id}
                          style={{
                            border: item.isExpanded
                              ? "1.5px solid var(--gm-brand)"
                              : "1px solid var(--gm-border)",
                            borderRadius: "10px",
                            background: item.isExpanded
                              ? "var(--gm-surface)"
                              : "var(--gm-surface-sunken)",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {/* Accordion Item Header */}
                          <div
                            style={{
                              padding: "10px 14px",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              userSelect: "none",
                              background: item.isExpanded
                                ? "rgba(37, 99, 235, 0.04)"
                                : "transparent",
                            }}
                          >
                            <div className="catalog-inline-center-10">
                              <button
                                type="button"
                                className="catalog-card-icon-btn"
                                style={{ width: "26px", height: "26px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleBulkItemExpanded(item.suggestion.id);
                                }}
                              >
                                <Icon
                                  name={item.isExpanded ? "arrow-up" : "arrow-down"}
                                  size={12}
                                />
                              </button>
                              <div>
                                <strong
                                  style={{
                                    fontSize: "0.88rem",
                                    color: "var(--gm-ink)",
                                    display: "block",
                                  }}
                                >
                                  {item.suggestion.name}
                                </strong>
                                <span className="catalog-muted-072">
                                  EAN {item.suggestion.eanBarcode} •{" "}
                                  {item.suggestion.currentStockUnits} {item.suggestion.unit}s em
                                  estoque
                                </span>
                              </div>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                              <div style={{ textAlign: "right" }}>
                                <span
                                  style={{
                                    fontSize: "0.72rem",
                                    color: "var(--gm-muted)",
                                    display: "block",
                                  }}
                                >
                                  Venda Salão
                                </span>
                                <strong style={{ fontSize: "0.88rem", color: "var(--gm-brand)" }}>
                                  {priceCents > 0 ? formatMoney(priceCents) : "R$ 0,00"}
                                </strong>
                              </div>
                              <button
                                type="button"
                                className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                                style={{ width: "28px", height: "28px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeBulkItem(item.suggestion.id);
                                }}
                                title="Remover este item do lote"
                              >
                                <Icon name="x" size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Accordion Item Body */}
                          {item.isExpanded && (
                            <div
                              style={{
                                padding: "14px",
                                borderTop: "1px solid var(--gm-border)",
                                display: "flex",
                                flexDirection: "column",
                                gap: "12px",
                                background: "var(--gm-surface)",
                              }}
                            >
                              {/* Detalhes de Fornecedor e Entrada do Estoque */}
                              <div
                                style={{
                                  background: "rgba(37, 99, 235, 0.05)",
                                  border: "1px solid rgba(37, 99, 235, 0.15)",
                                  borderRadius: "6px",
                                  padding: "8px 12px",
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "8px",
                                  fontSize: "0.78rem",
                                }}
                              >
                                <div>
                                  <span
                                    style={{
                                      color: "var(--gm-muted)",
                                      fontSize: "0.7rem",
                                      display: "block",
                                    }}
                                  >
                                    FORNECEDOR & ORIGEM
                                  </span>
                                  <strong className="catalog-ink">
                                    {item.suggestion.supplier}
                                  </strong>
                                  <div
                                    style={{
                                      color: "var(--gm-muted)",
                                      fontSize: "0.7rem",
                                      marginTop: "1px",
                                    }}
                                  >
                                    {item.suggestion.receivedDate}
                                  </div>
                                </div>
                                <div>
                                  <span
                                    style={{
                                      color: "var(--gm-muted)",
                                      fontSize: "0.7rem",
                                      display: "block",
                                    }}
                                  >
                                    CÓDIGO EAN / ESTOQUE ATUAL
                                  </span>
                                  <strong className="catalog-ink">
                                    EAN {item.suggestion.eanBarcode}
                                  </strong>
                                  <div
                                    style={{
                                      color: "#059669",
                                      fontWeight: 700,
                                      fontSize: "0.72rem",
                                      marginTop: "1px",
                                    }}
                                  >
                                    {item.suggestion.currentStockUnits} {item.suggestion.unit}s no
                                    estoque
                                  </div>
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "12px",
                                }}
                              >
                                <div>
                                  <label
                                    htmlFor={`bulk-resale-cost-${item.suggestion.id}`}
                                    className="catalog-label-block catalog-label-block--076"
                                  >
                                    Custo de Compra (Estoque)
                                  </label>
                                  <input
                                    disabled
                                    id={`bulk-resale-cost-${item.suggestion.id}`}
                                    value={formatMoney(item.suggestion.stockCostCents)}
                                    style={{
                                      width: "100%",
                                      padding: "7px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--gm-border)",
                                      background: "var(--gm-surface-sunken)",
                                      fontWeight: 700,
                                      fontSize: "0.84rem",
                                    }}
                                  />
                                </div>
                                <div>
                                  <label
                                    htmlFor={`bulk-resale-salon-price-${item.suggestion.id}`}
                                    className="catalog-label-block catalog-label-block--076"
                                  >
                                    Preço Salão (R$) *
                                  </label>
                                  <input
                                    id={`bulk-resale-salon-price-${item.suggestion.id}`}
                                    inputMode="decimal"
                                    value={item.salonPrice}
                                    onChange={(e) =>
                                      updateBulkItem(item.suggestion.id, {
                                        salonPrice: e.target.value,
                                      })
                                    }
                                    placeholder="0,00"
                                    style={{
                                      width: "100%",
                                      padding: "7px 10px",
                                      borderRadius: "6px",
                                      border: "1.5px solid var(--gm-brand)",
                                      fontWeight: 750,
                                      fontSize: "0.9rem",
                                    }}
                                  />
                                </div>
                              </div>

                              {/* Realtime Financial Pill */}
                              {priceCents > 0 && (
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "6px 10px",
                                    background:
                                      margin >= 50
                                        ? "rgba(16, 185, 129, 0.08)"
                                        : "rgba(245, 158, 11, 0.08)",
                                    border: `1px solid ${margin >= 50 ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.25)"}`,
                                    borderRadius: "6px",
                                    fontSize: "0.76rem",
                                  }}
                                >
                                  <span>
                                    Lucro: <strong>{formatMoney(profit)}</strong>
                                  </span>
                                  <span>
                                    Margem:{" "}
                                    <strong style={{ color: margin >= 50 ? "#059669" : "#d97706" }}>
                                      {margin}%
                                    </strong>
                                  </span>
                                  <span>
                                    Markup: <strong>{markup}x</strong>
                                  </span>
                                </div>
                              )}

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "12px",
                                }}
                              >
                                <div>
                                  <label
                                    htmlFor={`bulk-resale-delivery-price-${item.suggestion.id}`}
                                    className="catalog-label-block catalog-label-block--076"
                                  >
                                    Preço Delivery (Opcional)
                                  </label>
                                  <input
                                    id={`bulk-resale-delivery-price-${item.suggestion.id}`}
                                    inputMode="decimal"
                                    value={item.deliveryPrice}
                                    onChange={(e) =>
                                      updateBulkItem(item.suggestion.id, {
                                        deliveryPrice: e.target.value,
                                      })
                                    }
                                    placeholder="Ex: 14,90"
                                    style={{
                                      width: "100%",
                                      padding: "7px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--gm-border)",
                                      fontSize: "0.84rem",
                                    }}
                                  />
                                </div>

                                <div>
                                  <label
                                    htmlFor={`bulk-resale-category-${item.suggestion.id}`}
                                    className="catalog-label-block catalog-label-block--076"
                                  >
                                    Categoria
                                  </label>
                                  <select
                                    id={`bulk-resale-category-${item.suggestion.id}`}
                                    value={item.category}
                                    onChange={(e) =>
                                      updateBulkItem(item.suggestion.id, {
                                        category: e.target.value,
                                      })
                                    }
                                    style={{
                                      width: "100%",
                                      padding: "7px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--gm-border)",
                                      background: "var(--gm-surface)",
                                      color: "var(--gm-ink)",
                                      fontSize: "0.84rem",
                                    }}
                                  >
                                    {catalog.categories.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                    <option value={item.suggestion.suggestedCategoryName}>
                                      + Criar "{item.suggestion.suggestedCategoryName}"
                                    </option>
                                  </select>
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr 1fr",
                                  gap: "12px",
                                  alignItems: "flex-start",
                                }}
                              >
                                <div>
                                  <label
                                    htmlFor={`bulk-resale-station-${item.suggestion.id}`}
                                    className="catalog-label-block catalog-label-block--076"
                                  >
                                    Praça de Saída
                                  </label>
                                  <select
                                    id={`bulk-resale-station-${item.suggestion.id}`}
                                    value={item.station}
                                    onChange={(e) =>
                                      updateBulkItem(item.suggestion.id, {
                                        station: e.target.value,
                                      })
                                    }
                                    style={{
                                      width: "100%",
                                      padding: "7px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid var(--gm-border)",
                                      background: "var(--gm-surface)",
                                      color: "var(--gm-ink)",
                                      fontSize: "0.84rem",
                                    }}
                                  >
                                    {catalog.stations.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label
                                    htmlFor={`bulk-resale-image-${item.suggestion.id}`}
                                    className="catalog-label-block catalog-label-block--076"
                                  >
                                    Foto do Produto (Opcional)
                                  </label>
                                  <input
                                    id={`bulk-resale-image-${item.suggestion.id}`}
                                    type="file"
                                    accept="image/*"
                                    style={{ fontSize: "0.76rem", width: "100%", padding: "4px 0" }}
                                    onChange={(event) => {
                                      const file = event.target.files?.[0];
                                      if (!file) return;
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
                                            updateBulkItem(item.suggestion.id, {
                                              imageUrl: canvas.toDataURL("image/jpeg", 0.7),
                                            });
                                          }
                                        };
                                        img.src = e.target?.result as string;
                                      };
                                      reader.readAsDataURL(file);
                                    }}
                                  />
                                </div>
                              </div>

                              {item.imageUrl && (
                                <div
                                  style={{
                                    position: "relative",
                                    display: "inline-block",
                                    marginTop: "2px",
                                  }}
                                >
                                  <img
                                    src={item.imageUrl}
                                    alt="Preview"
                                    style={{
                                      maxHeight: "70px",
                                      borderRadius: "6px",
                                      objectFit: "cover",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                                    style={{
                                      position: "absolute",
                                      top: "-6px",
                                      right: "-6px",
                                      width: "22px",
                                      height: "22px",
                                    }}
                                    onClick={() =>
                                      updateBulkItem(item.suggestion.id, { imageUrl: "" })
                                    }
                                    title="Remover foto"
                                  >
                                    <Icon name="x" size={10} />
                                  </button>
                                </div>
                              )}

                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  padding: "8px 12px",
                                  borderRadius: "6px",
                                  background: "var(--gm-surface-sunken)",
                                  border: "1px solid var(--gm-border)",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  id={`bulk-auto-deduct-${item.suggestion.id}`}
                                  checked={item.autoDeduct}
                                  onChange={(e) =>
                                    updateBulkItem(item.suggestion.id, {
                                      autoDeduct: e.target.checked,
                                    })
                                  }
                                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                                />
                                <label
                                  htmlFor={`bulk-auto-deduct-${item.suggestion.id}`}
                                  style={{
                                    margin: 0,
                                    fontSize: "0.8rem",
                                    fontWeight: 650,
                                    color: "var(--gm-ink)",
                                    cursor: "pointer",
                                  }}
                                >
                                  Habilitar baixa automática 1-para-1 no estoque físico na venda
                                  deste item
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Bulk Footer actions */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      marginTop: "12px",
                      borderTop: "1px solid var(--gm-border)",
                      paddingTop: "14px",
                    }}
                  >
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setBulkResaleModalOpen(false);
                        setBulkResaleItems([]);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      variant="primary"
                      onClick={confirmBulkResaleInclusion}
                      disabled={bulkResaleItems.length === 0}
                    >
                      <Icon name="check" size={14} />
                      <span>Adicionar {bulkResaleItems.length} Itens ao Cardápio</span>
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

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
                      Crie e gerencie grupos de complementos (ex: Ponto da Carne, Turbine seu
                      Burger, Molhos) reutilizáveis em qualquer prato.
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
                      <label className="catalog-field catalog-field--compact">
                        Nome do Grupo *
                        <input
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
                      </label>
                      <label className="catalog-field catalog-field--compact">
                        Mínimo de Escolhas
                        <input
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
                      </label>
                      <label className="catalog-field catalog-field--compact">
                        Máximo de Escolhas
                        <input
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
                      </label>
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
                                {grp.minimumSelections > 0 ? "Obrigatório" : "Opcional"} • Escolha
                                de {grp.minimumSelections} até {grp.maximumSelections} opções (
                                {groupOptions.length} cadastradas)
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="catalog-card-icon-btn"
                                onClick={() => setEditingGroupId(isEditing ? null : grp.id)}
                                title="Adicionar / Editar opções deste grupo"
                              >
                                <Icon name="plus" size={14} />
                              </button>
                              <button
                                type="button"
                                className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                                disabled={busy === `modifier-group-${grp.id}`}
                                onClick={() => void removeModifierGroup(grp.id)}
                                title="Excluir Grupo"
                              >
                                <Icon name="x" size={14} />
                              </button>
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
                                <button
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
                                </button>
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
                              <input
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
                              <input
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
                      <span
                        style={{ fontSize: "0.8rem", color: "var(--gm-muted)", display: "block" }}
                      >
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

                          <div
                            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}
                          >
                            {grpOpts.map((opt) => {
                              const isSelected = currentSelected.includes(opt.id);
                              return (
                                <button
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
                                      color:
                                        opt.priceDeltaCents > 0 ? "#059669" : "var(--gm-muted)",
                                    }}
                                  >
                                    {opt.priceDeltaCents > 0
                                      ? `+${formatMoney(opt.priceDeltaCents)}`
                                      : "Grátis"}
                                  </span>
                                </button>
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
            {promosAndCombosModalOpen && (
              <Modal
                isOpen={promosAndCombosModalOpen}
                onClose={() => setPromosAndCombosModalOpen(false)}
                title="Gestão de Combos & Promoções de Horário"
                size="lg"
              >
                <div className="catalog-stack catalog-stack--16">
                  {/* Abas */}
                  <div
                    style={{
                      display: "flex",
                      borderBottom: "1px solid var(--gm-border)",
                      gap: "8px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setPromoTab("combos")}
                      style={{
                        padding: "8px 16px",
                        border: "none",
                        background: "transparent",
                        borderBottom:
                          promoTab === "combos"
                            ? "2px solid var(--gm-brand)"
                            : "2px solid transparent",
                        color: promoTab === "combos" ? "var(--gm-brand)" : "var(--gm-muted)",
                        fontWeight: 700,
                        fontSize: "0.88rem",
                        cursor: "pointer",
                      }}
                    >
                      Combos Especiais ({catalog.combos.length})
                    </button>
                    {
                      <button
                        type="button"
                        onClick={() => setPromoTab("happyhour")}
                        style={{
                          padding: "8px 16px",
                          border: "none",
                          background: "transparent",
                          borderBottom:
                            promoTab === "happyhour"
                              ? "2px solid var(--gm-brand)"
                              : "2px solid transparent",
                          color: promoTab === "happyhour" ? "var(--gm-brand)" : "var(--gm-muted)",
                          fontWeight: 700,
                          fontSize: "0.88rem",
                          cursor: "pointer",
                        }}
                      >
                        Promoções & Happy Hour
                      </button>
                    }
                  </div>

                  {promoTab === "combos" ? (
                    <div className="catalog-stack catalog-stack--14">
                      {/* Criar Novo Combo */}
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
                          + Criar Novo Combo Inteligente
                        </strong>
                        <div className="catalog-combo-form-grid">
                          <input
                            placeholder="Nome do Combo (Ex: Combo Casal, Burger + Refri...)"
                            aria-label="Nome do combo"
                            value={newComboName}
                            onChange={(e) => setNewComboName(e.target.value)}
                            style={{
                              height: "38px",
                              padding: "0 10px",
                              borderRadius: "6px",
                              border: "1px solid var(--gm-border)",
                              background: "var(--gm-surface)",
                              color: "var(--gm-ink)",
                              fontSize: "0.86rem",
                            }}
                          />
                          <input
                            placeholder="Preço Promocional do Combo (R$)"
                            aria-label="Preço promocional do combo"
                            inputMode="decimal"
                            value={newComboPrice}
                            onChange={(e) => setNewComboPrice(e.target.value)}
                            style={{
                              height: "38px",
                              padding: "0 10px",
                              borderRadius: "6px",
                              border: "1px solid var(--gm-border)",
                              background: "var(--gm-surface)",
                              color: "var(--gm-ink)",
                              fontSize: "0.86rem",
                              fontWeight: 700,
                            }}
                          />
                        </div>
                        <input
                          placeholder="Descrição do combo (Ex: 1 Hambúrguer + 1 Batata + 1 Bebida com 20% de economia)"
                          aria-label="Descrição do combo"
                          value={newComboDesc}
                          onChange={(e) => setNewComboDesc(e.target.value)}
                          style={{
                            width: "100%",
                            height: "36px",
                            padding: "0 10px",
                            borderRadius: "6px",
                            border: "1px solid var(--gm-border)",
                            background: "var(--gm-surface)",
                            color: "var(--gm-ink)",
                            fontSize: "0.82rem",
                            boxSizing: "border-box",
                            marginBottom: "10px",
                          }}
                        />

                        <div>
                          <span
                            style={{
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              color: "var(--gm-ink)",
                              display: "block",
                              marginBottom: "6px",
                            }}
                          >
                            Selecione os Produtos Inclusos no Combo:
                          </span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {catalog.products
                              .filter((product) => product.active)
                              .map((p) => {
                                const isSelected = newComboProductIds.includes(p.id);
                                return (
                                  <button
                                    key={p.id}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => {
                                      if (isSelected)
                                        setNewComboProductIds(
                                          newComboProductIds.filter((id) => id !== p.id),
                                        );
                                      else setNewComboProductIds([...newComboProductIds, p.id]);
                                    }}
                                    style={{
                                      fontSize: "0.78rem",
                                      padding: "4px 10px",
                                      borderRadius: "9999px",
                                      border: isSelected
                                        ? "1.5px solid var(--gm-brand)"
                                        : "1px solid var(--gm-border)",
                                      background: isSelected
                                        ? "rgba(16, 185, 129, 0.12)"
                                        : "var(--gm-surface)",
                                      color: "var(--gm-ink)",
                                      cursor: "pointer",
                                      fontWeight: isSelected ? 700 : 500,
                                    }}
                                  >
                                    {isSelected ? "✓ " : "+ "}
                                    {p.name} ({formatMoney(p.priceCents)})
                                  </button>
                                );
                              })}
                          </div>
                        </div>

                        {newComboProductIds.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginTop: "12px",
                              paddingTop: "10px",
                              borderTop: "1px dashed var(--gm-border)",
                            }}
                          >
                            {(() => {
                              const sumAvulso = newComboProductIds.reduce((acc, id) => {
                                const prod = catalog.products.find((p) => p.id === id);
                                return acc + (prod?.priceCents || 0);
                              }, 0);
                              const promoCents = priceToCents(newComboPrice) || 0;
                              const economia =
                                sumAvulso > promoCents && promoCents > 0
                                  ? sumAvulso - promoCents
                                  : 0;

                              return (
                                <div>
                                  <span style={{ fontSize: "0.78rem", color: "var(--gm-muted)" }}>
                                    Valor avulso: {formatMoney(sumAvulso)}
                                  </span>
                                  {economia > 0 && (
                                    <span
                                      style={{
                                        fontSize: "0.78rem",
                                        color: "#059669",
                                        fontWeight: 700,
                                        marginLeft: "10px",
                                      }}
                                    >
                                      Economia para o cliente: {formatMoney(economia)} (
                                      {Math.round((economia / sumAvulso) * 100)}% OFF)
                                    </span>
                                  )}
                                </div>
                              );
                            })()}

                            <Button
                              variant="primary"
                              size="sm"
                              disabled={
                                busy === "combo" ||
                                newComboName.trim().length < 2 ||
                                newComboPrice.trim() === "" ||
                                priceToCents(newComboPrice) < 0 ||
                                newComboProductIds.length === 0
                              }
                              onClick={createCombo}
                            >
                              <Icon name="check" size={13} />
                              <span>{busy === "combo" ? "Salvando…" : "Salvar Combo"}</span>
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Lista de Combos Ativos */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {catalog.combos.map((cmb) => (
                          <div
                            key={cmb.id}
                            style={{
                              padding: "12px 16px",
                              borderRadius: "8px",
                              border: "1px solid var(--gm-border)",
                              background: "var(--gm-surface)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: "0.95rem", color: "var(--gm-ink)" }}>
                                {cmb.name}
                              </strong>
                              <span
                                style={{
                                  fontSize: "0.8rem",
                                  color: "var(--gm-brand)",
                                  fontWeight: 800,
                                  marginLeft: "10px",
                                }}
                              >
                                {formatMoney(cmb.priceCents)}
                              </span>
                              {cmb.description && (
                                <p
                                  style={{
                                    margin: "4px 0 0 0",
                                    fontSize: "0.78rem",
                                    color: "var(--gm-muted)",
                                  }}
                                >
                                  {cmb.description}
                                </p>
                              )}
                              <div
                                style={{
                                  display: "flex",
                                  gap: "4px",
                                  marginTop: "6px",
                                  flexWrap: "wrap",
                                }}
                              >
                                {cmb.items.map((it) => {
                                  const prod = catalog.products.find((p) => p.id === it.productId);
                                  return (
                                    <span
                                      key={it.productId}
                                      style={{
                                        fontSize: "0.7rem",
                                        padding: "2px 6px",
                                        background: "var(--gm-surface-soft)",
                                        borderRadius: "4px",
                                        color: "var(--gm-muted)",
                                      }}
                                    >
                                      {it.quantity}x {prod?.name || "Item"}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>

                            {
                              <button
                                type="button"
                                className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                                disabled={busy === `combo-${cmb.id}`}
                                onClick={() => void removeCombo(cmb.id)}
                                title="Excluir combo"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            }
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Aba Happy Hour & Promoções Avançada */
                    <div className="catalog-stack catalog-stack--16">
                      {/* Formulário Construtor de Campanha de Happy Hour */}
                      <div
                        style={{
                          padding: "16px 18px",
                          background: "var(--gm-surface-soft)",
                          borderRadius: "10px",
                          border: "1px solid var(--gm-border)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "12px",
                        }}
                      >
                        <strong
                          style={{ fontSize: "0.9rem", color: "var(--gm-ink)", display: "block" }}
                        >
                          + Criar Nova Campanha de Happy Hour / Promoção Programada
                        </strong>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1.5fr 1fr 1fr",
                            gap: "10px",
                          }}
                        >
                          <label className="catalog-field catalog-field--compact">
                            Nome da Campanha *
                            <input
                              placeholder="Ex: Happy Hour Chopp & Petiscos..."
                              value={promoName}
                              onChange={(e) => setPromoName(e.target.value)}
                              style={{
                                height: "36px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                border: "1px solid var(--gm-border)",
                                background: "var(--gm-surface)",
                                color: "var(--gm-ink)",
                                fontSize: "0.85rem",
                              }}
                            />
                          </label>

                          <label className="catalog-field catalog-field--compact">
                            Tipo de Desconto
                            <select
                              value={promoType}
                              onChange={(e) => setPromoType(e.target.value as any)}
                              style={{
                                height: "36px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                border: "1px solid var(--gm-border)",
                                background: "var(--gm-surface)",
                                color: "var(--gm-ink)",
                                fontSize: "0.82rem",
                                fontWeight: 600,
                              }}
                            >
                              <option value="percentage">% de Desconto</option>
                              <option value="fixed_price">Preço Fixo Promocional (R$)</option>
                            </select>
                          </label>

                          <label className="catalog-field catalog-field--compact">
                            {promoType === "percentage"
                              ? "% de desconto *"
                              : "Preço promocional final (R$) *"}
                            <input
                              placeholder={
                                promoType === "percentage" ? "Ex: 25 (para 25%)" : "Ex: 12,00"
                              }
                              value={promoValue}
                              onChange={(e) => setPromoValue(e.target.value)}
                              style={{
                                height: "36px",
                                padding: "0 10px",
                                borderRadius: "6px",
                                border: "1px solid var(--gm-border)",
                                background: "var(--gm-surface)",
                                color: "var(--gm-ink)",
                                fontSize: "0.85rem",
                                fontWeight: 700,
                              }}
                            />
                          </label>
                        </div>

                        {/* Dias da Semana Interativos */}
                        <div>
                          <span
                            style={{
                              fontSize: "0.78rem",
                              fontWeight: 700,
                              color: "var(--gm-ink)",
                              display: "block",
                              marginBottom: "6px",
                            }}
                          >
                            Dias da Semana Válidos:
                          </span>
                          <div className="catalog-wrap-6">
                            {[
                              { day: 0, label: "Dom" },
                              { day: 1, label: "Seg" },
                              { day: 2, label: "Ter" },
                              { day: 3, label: "Qua" },
                              { day: 4, label: "Qui" },
                              { day: 5, label: "Sex" },
                              { day: 6, label: "Sáb" },
                            ].map((d) => {
                              const isChecked = promoDays.includes(d.day);
                              return (
                                <button
                                  key={d.day}
                                  type="button"
                                  onClick={() => {
                                    if (isChecked)
                                      setPromoDays(promoDays.filter((x) => x !== d.day));
                                    else setPromoDays([...promoDays, d.day].sort());
                                  }}
                                  style={{
                                    padding: "6px 14px",
                                    borderRadius: "6px",
                                    fontSize: "0.8rem",
                                    fontWeight: isChecked ? 750 : 500,
                                    border: isChecked
                                      ? "1.5px solid var(--gm-brand)"
                                      : "1px solid var(--gm-border)",
                                    background: isChecked
                                      ? "rgba(16, 185, 129, 0.12)"
                                      : "var(--gm-surface)",
                                    color: isChecked ? "var(--gm-ink)" : "var(--gm-muted)",
                                    cursor: "pointer",
                                  }}
                                >
                                  {d.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Horário e Canais */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1.5fr",
                            gap: "10px",
                            alignItems: "flex-end",
                          }}
                        >
                          <label className="catalog-field catalog-field--compact">
                            Horário de Início
                            <input
                              type="time"
                              value={promoStart}
                              onChange={(e) => setPromoStart(e.target.value)}
                              className="catalog-control-36"
                            />
                          </label>

                          <label className="catalog-field catalog-field--compact">
                            Horário de Fim
                            <input
                              type="time"
                              value={promoEnd}
                              onChange={(e) => setPromoEnd(e.target.value)}
                              className="catalog-control-36"
                            />
                          </label>

                          <div
                            style={{
                              display: "flex",
                              gap: "10px",
                              alignItems: "center",
                              height: "36px",
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "0.76rem",
                                color: "var(--gm-ink)",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={promoSalon}
                                onChange={(e) => setPromoSalon(e.target.checked)}
                              />
                              Salão
                            </label>
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "0.76rem",
                                color: "var(--gm-ink)",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={promoQr}
                                onChange={(e) => setPromoQr(e.target.checked)}
                              />
                              QR Mesa
                            </label>
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                fontSize: "0.76rem",
                                color: "var(--gm-ink)",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={promoDelivery}
                                onChange={(e) => setPromoDelivery(e.target.checked)}
                              />
                              Delivery
                            </label>
                          </div>
                        </div>

                        {/* Seleção em 2 Níveis: Categorias Inteiras OU Produtos Individuais Específicos */}
                        <div className="catalog-stack catalog-stack--8">
                          <span
                            style={{
                              fontSize: "0.8rem",
                              fontWeight: 700,
                              color: "var(--gm-ink)",
                              display: "block",
                            }}
                          >
                            1. Aplicar por Categoria Inteira (Opcional):
                          </span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {catalog.categories.map((cat) => {
                              const isSelected = promoCategoryIds.includes(cat.id);
                              return (
                                <button
                                  key={cat.id}
                                  type="button"
                                  onClick={() => {
                                    if (isSelected)
                                      setPromoCategoryIds(
                                        promoCategoryIds.filter((id) => id !== cat.id),
                                      );
                                    else setPromoCategoryIds([...promoCategoryIds, cat.id]);
                                  }}
                                  style={{
                                    fontSize: "0.76rem",
                                    padding: "4px 10px",
                                    borderRadius: "9999px",
                                    border: isSelected
                                      ? "1.5px solid var(--gm-brand)"
                                      : "1px solid var(--gm-border)",
                                    background: isSelected
                                      ? "rgba(16, 185, 129, 0.15)"
                                      : "var(--gm-surface)",
                                    color: "var(--gm-ink)",
                                    fontWeight: isSelected ? 700 : 500,
                                    cursor: "pointer",
                                  }}
                                >
                                  {isSelected ? "✓ Categoria: " : "+ Categoria: "}
                                  {cat.name}
                                </button>
                              );
                            })}
                          </div>

                          <div style={{ marginTop: "4px" }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "4px",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "0.8rem",
                                  fontWeight: 700,
                                  color: "var(--gm-ink)",
                                }}
                              >
                                2. Ou Selecionar Produtos Específicos:
                              </span>
                              <input
                                placeholder="Filtrar prato..."
                                value={promoProductSearch}
                                onChange={(e) => setPromoProductSearch(e.target.value)}
                                style={{
                                  height: "26px",
                                  padding: "0 8px",
                                  fontSize: "0.74rem",
                                  borderRadius: "4px",
                                  border: "1px solid var(--gm-border)",
                                  background: "var(--gm-surface)",
                                  color: "var(--gm-ink)",
                                }}
                              />
                            </div>

                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "6px",
                                maxHeight: "120px",
                                overflowY: "auto",
                                padding: "4px",
                                background: "var(--gm-surface)",
                                borderRadius: "6px",
                                border: "1px solid var(--gm-border)",
                              }}
                            >
                              {catalog.products
                                .filter(
                                  (p) =>
                                    !promoProductSearch ||
                                    p.name.toLowerCase().includes(promoProductSearch.toLowerCase()),
                                )
                                .map((p) => {
                                  const isSelected = promoProductIds.includes(p.id);
                                  const catName = catalog.categories.find(
                                    (c) => c.id === p.categoryId,
                                  )?.name;
                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => {
                                        if (isSelected)
                                          setPromoProductIds(
                                            promoProductIds.filter((id) => id !== p.id),
                                          );
                                        else setPromoProductIds([...promoProductIds, p.id]);
                                      }}
                                      style={{
                                        fontSize: "0.74rem",
                                        padding: "3px 8px",
                                        borderRadius: "6px",
                                        border: isSelected
                                          ? "1.5px solid #6366f1"
                                          : "1px solid var(--gm-border)",
                                        background: isSelected
                                          ? "rgba(99, 102, 241, 0.15)"
                                          : "var(--gm-surface-soft)",
                                        color: isSelected ? "var(--gm-ink)" : "var(--gm-muted)",
                                        fontWeight: isSelected ? 700 : 500,
                                        cursor: "pointer",
                                      }}
                                    >
                                      {isSelected ? "✓ " : "+ "}
                                      {p.name}{" "}
                                      <small style={{ opacity: 0.7 }}>
                                        ({catName} • {formatMoney(p.priceCents)})
                                      </small>
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "flex-end",
                            marginTop: "4px",
                            paddingTop: "8px",
                            borderTop: "1px dashed var(--gm-border)",
                          }}
                        >
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={promoName.trim().length < 2 || promoDays.length === 0}
                            onClick={() => void savePromotion()}
                          >
                            <Icon name="check" size={13} />
                            <span>Salvar Regra de Happy Hour</span>
                          </Button>
                        </div>
                      </div>

                      {/* Lista de Campanhas Ativas */}
                      <strong style={{ fontSize: "0.86rem", color: "var(--gm-ink)" }}>
                        Campanhas Configuradas ({(catalog.promotions || []).length})
                      </strong>

                      <div className="catalog-stack catalog-stack--8">
                        {(catalog.promotions || []).map((p) => {
                          const daysNames = p.daysOfWeek
                            .map((d) => ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d])
                            .join(", ");
                          return (
                            <div
                              key={p.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "12px 16px",
                                borderRadius: "8px",
                                border: "1px solid var(--gm-border)",
                                background: "var(--gm-surface)",
                              }}
                            >
                              <div>
                                <div className="catalog-inline-center-8">
                                  <strong style={{ fontSize: "0.92rem", color: "var(--gm-ink)" }}>
                                    {p.name}
                                  </strong>
                                  <span
                                    style={{
                                      fontSize: "0.72rem",
                                      background: "rgba(245, 158, 11, 0.12)",
                                      color: "#d97706",
                                      border: "1px solid rgba(245, 158, 11, 0.3)",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {p.discountType === "percentage"
                                      ? `${p.discountValue}% OFF`
                                      : `Preço Especial ${formatMoney(p.discountValue)}`}
                                  </span>
                                </div>
                                <span
                                  style={{
                                    fontSize: "0.76rem",
                                    color: "var(--gm-muted)",
                                    display: "block",
                                    marginTop: "2px",
                                  }}
                                >
                                  {daysNames} • {p.startTime} às {p.endTime} •{" "}
                                  {[
                                    p.channels.salon && "Salão",
                                    p.channels.qrMesa && "QR Mesa",
                                    p.channels.delivery && "Delivery",
                                  ]
                                    .filter(Boolean)
                                    .join(", ")}
                                </span>
                              </div>

                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  className={`catalog-card-btn ${p.active ? "catalog-card-btn--pause" : "catalog-card-btn--active"}`}
                                  style={{ height: "30px", fontSize: "0.74rem" }}
                                  disabled={busy === `promotion-${p.id}`}
                                  onClick={() => void togglePromotion(p)}
                                >
                                  <Icon name={p.active ? "minus" : "check"} size={12} />
                                  <span>{p.active ? "Pausar" : "Ativar"}</span>
                                </button>
                                <button
                                  type="button"
                                  className="catalog-card-icon-btn catalog-card-icon-btn--danger"
                                  disabled={busy === `promotion-${p.id}`}
                                  onClick={() => void removePromotion(p.id)}
                                  title="Excluir campanha"
                                >
                                  <Icon name="x" size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="catalog-actions-end">
                    <Button variant="primary" onClick={() => setPromosAndCombosModalOpen(false)}>
                      Fechar
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

            {/* Modal de Personalização & Branding da Casa */}
            {brandingModalOpen && (
              <Modal
                isOpen={brandingModalOpen}
                onClose={() => setBrandingModalOpen(false)}
                title="Personalização & Identidade Visual do Cardápio"
                size="md"
              >
                <div className="catalog-form-stack">
                  <p className="catalog-muted-copy-084">
                    Configure as informações e identidade visual da sua marca exibidas no Cardápio
                    Digital (QR) e nas impressões.
                  </p>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: "var(--gm-ink)",
                    }}
                  >
                    Nome Fantasia do Estabelecimento *
                    <input
                      value={restaurantName}
                      onChange={(e) => setRestaurantName(e.target.value)}
                      placeholder="Ex: GiroMesa Bistrô & Bar..."
                      style={{
                        height: "40px",
                        padding: "0 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--gm-border)",
                        background: "var(--gm-surface)",
                        color: "var(--gm-ink)",
                        fontSize: "0.9rem",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: "var(--gm-ink)",
                    }}
                  >
                    Slogan / Subtítulo da Casa
                    <input
                      value={restaurantSlogan}
                      onChange={(e) => setRestaurantSlogan(e.target.value)}
                      placeholder="Ex: Cardápio Autoral & Gastronomia Artesanal..."
                      style={{
                        height: "40px",
                        padding: "0 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--gm-border)",
                        background: "var(--gm-surface)",
                        color: "var(--gm-ink)",
                        fontSize: "0.85rem",
                      }}
                    />
                  </label>

                  {/* Cor da Marca */}
                  <div>
                    <span
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: "var(--gm-ink)",
                        display: "block",
                        marginBottom: "6px",
                      }}
                    >
                      Cor Primária da Marca (Identidade Visual)
                    </span>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      {[
                        { color: "#10b981", name: "Esmeralda" },
                        { color: "#6366f1", name: "Índigo" },
                        { color: "#e11d48", name: "Carmesim" },
                        { color: "#f59e0b", name: "Âmbar" },
                        { color: "#3b82f6", name: "Azul Real" },
                        { color: "#334155", name: "Grafite" },
                      ].map((c) => (
                        <button
                          key={c.color}
                          type="button"
                          onClick={() => setBrandColor(c.color)}
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            background: c.color,
                            border:
                              brandColor === c.color
                                ? "3px solid var(--gm-ink)"
                                : "2px solid transparent",
                            cursor: "pointer",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                          }}
                          title={c.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Logo e Informações de Contato / Localização */}
                  <div
                    style={{
                      background: "var(--gm-surface-soft)",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <strong style={{ fontSize: "0.82rem", color: "var(--gm-ink)" }}>
                      Logo & Dados de Contato do Restaurante
                    </strong>

                    <div className="catalog-grid-2 catalog-grid-2--compact">
                      <label className="catalog-helper-stack">
                        Logo da Casa (Upload de Imagem)
                        <input
                          type="file"
                          accept="image/*"
                          style={{ fontSize: "0.76rem", padding: "4px 0" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (
                              !(["image/jpeg", "image/png", "image/webp"] as string[]).includes(
                                file.type,
                              )
                            ) {
                              setFeedback("Use uma imagem JPG, PNG ou WEBP.", "danger");
                              e.target.value = "";
                              return;
                            }
                            if (file.size > 2 * 1024 * 1024) {
                              setFeedback("A imagem do logo deve ter no máximo 2 MB.", "danger");
                              e.target.value = "";
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              setRestaurantLogoUrl(ev.target?.result as string);
                              setRestaurantLogoFileName(file.name);
                              setFeedback("Logo pronto para salvar.");
                            };
                            reader.onerror = () =>
                              setFeedback("Não foi possível ler a imagem.", "danger");
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>

                      <label className="catalog-helper-stack">
                        Telefone / WhatsApp para Contato
                        <input
                          value={restaurantPhone}
                          onChange={(e) => setRestaurantPhone(e.target.value)}
                          placeholder="(11) 98765-4321"
                          className="catalog-control-34"
                        />
                      </label>
                    </div>

                    <div className="catalog-grid-main">
                      <label className="catalog-helper-stack">
                        Endereço Completo do Estabelecimento
                        <input
                          value={restaurantAddress}
                          onChange={(e) => setRestaurantAddress(e.target.value)}
                          placeholder="Rua, Número - Bairro, Cidade - UF"
                          className="catalog-control-34"
                        />
                      </label>

                      <label className="catalog-helper-stack">
                        Instagram / Redes Sociais
                        <input
                          value={restaurantInstagram}
                          onChange={(e) => setRestaurantInstagram(e.target.value)}
                          placeholder="@seurestaurante"
                          className="catalog-control-34"
                        />
                      </label>
                    </div>

                    <label className="catalog-helper-stack">
                      Horário de Atendimento da Casa
                      <input
                        value={restaurantOpeningHours}
                        onChange={(e) => setRestaurantOpeningHours(e.target.value)}
                        placeholder="Ex: Terça a Domingo: 12h às 23h30"
                        className="catalog-control-34"
                      />
                    </label>
                  </div>

                  {/* Avisos de Mesa */}
                  <div
                    style={{
                      background: "var(--gm-surface-soft)",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      border: "1px solid var(--gm-border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <strong style={{ fontSize: "0.82rem", color: "var(--gm-ink)" }}>
                      Avisos de Rodapé & Informações ao Cliente
                    </strong>

                    <label className="catalog-helper-stack">
                      Taxa de Serviço / Informação Fiscal
                      <input
                        value={serviceTaxNotice}
                        onChange={(e) => setServiceTaxNotice(e.target.value)}
                        className="catalog-control-34"
                      />
                    </label>

                    <label className="catalog-helper-stack">
                      Aviso de Wi-Fi para Clientes
                      <input
                        value={wifiNotice}
                        onChange={(e) => setWifiNotice(e.target.value)}
                        className="catalog-control-34"
                      />
                    </label>

                    <label className="catalog-helper-stack">
                      Taxa de Rolha / Observação Especial
                      <input
                        value={corkageNotice}
                        onChange={(e) => setCorkageNotice(e.target.value)}
                        className="catalog-control-34"
                      />
                    </label>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "10px",
                      marginTop: "4px",
                    }}
                  >
                    <Button variant="ghost" onClick={() => setBrandingModalOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy === "branding"}
                      onClick={() => void saveBranding()}
                    >
                      Salvar Identidade
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

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
                      <label className="catalog-clickable-row">
                        <input
                          type="radio"
                          name="pdfLayout"
                          checked={pdfLayoutMode === "modern"}
                          onChange={() => setPdfLayoutMode("modern")}
                        />
                        <span>Moderno Gastronômico (com fotos)</span>
                      </label>
                      <label className="catalog-clickable-row">
                        <input
                          type="radio"
                          name="pdfLayout"
                          checked={pdfLayoutMode === "bistro"}
                          onChange={() => setPdfLayoutMode("bistro")}
                        />
                        <span>Bistrô Minimalista (2 Colunas)</span>
                      </label>
                    </div>

                    <strong
                      style={{ fontSize: "0.88rem", color: "var(--gm-ink)", marginTop: "8px" }}
                    >
                      Elementos Exibidos
                    </strong>

                    <div className="catalog-stack catalog-stack--8">
                      <label className="catalog-clickable-row">
                        <input
                          type="checkbox"
                          checked={pdfShowPhotos}
                          onChange={(e) => setPdfShowPhotos(e.target.checked)}
                        />
                        <span>Incluir Fotos dos Pratos</span>
                      </label>
                      <label className="catalog-clickable-row">
                        <input
                          type="checkbox"
                          checked={pdfShowDescriptions}
                          onChange={(e) => setPdfShowDescriptions(e.target.checked)}
                        />
                        <span>Incluir Descrições & Ingredientes</span>
                      </label>
                      <label className="catalog-clickable-row">
                        <input
                          type="checkbox"
                          checked={pdfShowQr}
                          onChange={(e) => setPdfShowQr(e.target.checked)}
                        />
                        <span>Incluir QR Code de Autoatendimento</span>
                      </label>
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
                          <strong
                            style={{ fontSize: "0.82rem", color: "#0f172a", display: "block" }}
                          >
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
      }}
    </RemoteGate>
  );
}
