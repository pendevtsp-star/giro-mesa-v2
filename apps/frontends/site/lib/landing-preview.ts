import type { ProductSlide } from "../components/product-showcase";

// Editorial preview only: replace these captures after the Ops visual review.
// These are unaltered screenshots of the current local QA application, not customer results.
export const landingPreview =
  process.env.NODE_ENV !== "production" && process.env.SITE_LANDING_PREVIEW === "1";

export const previewDescription = "Do primeiro pedido ao fechamento, sua operação conectada.";

export const currentProductScreens: ProductSlide[] = [
  {
    src: "/product/salao-atual.jpg",
    alt: "Tela atual de Mesas e comandas do GiroMesa, capturada na unidade local de teste.",
    label: "Mesas e comandas",
    description: "Veja o status das mesas e acompanhe os pedidos e a conta de cada atendimento.",
    width: 1280,
    height: 720,
  },
  {
    src: "/product/balcao-atual.jpg",
    alt: "Tela atual de Balcão e retirada do GiroMesa, com pedidos do ambiente local de teste.",
    label: "Balcão e retirada",
    description: "Consulte os pedidos do balcão e acompanhe a etapa de cada atendimento.",
    width: 1270,
    height: 714,
  },
  {
    src: "/product/cardapio-atual.jpg",
    alt: "Cardápio operacional atual do GiroMesa, capturado no ambiente local de teste.",
    label: "Cardápio",
    description: "Organize os produtos, confira preços e ajuste a disponibilidade no cardápio.",
    width: 1270,
    height: 714,
  },
];
