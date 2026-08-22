type TranslationLanguage = "en" | "es";

type Translation = Record<TranslationLanguage, string>;

const PHRASES: Record<string, Translation> = {
  "risoto do cerrado": {
    en: "Cerrado Wild Mushroom & Baru Risotto",
    es: "Risotto del Cerrado con Setas y Barú",
  },
  "arroz arbóreo": { en: "Arborio rice", es: "Arroz arbóreo" },
  "castanha de baru": { en: "Baru nut", es: "Nuez de Barú" },
  "castanhas de baru": { en: "Baru nuts", es: "Nueces de Barú" },
  "queijo meia cura": {
    en: "Aged artisanal Minas cheese",
    es: "Queso curado artesanal",
  },
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
  "ao molho quatro queijos": {
    en: "with four-cheese sauce",
    es: "con salsa cuatro quesos",
  },
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

const WORDS: Record<string, Translation> = {
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

function translateText(text: string, language: TranslationLanguage): string {
  if (!text.trim()) return "";

  let result = text;
  for (const [phrase, translation] of Object.entries(PHRASES)) {
    result = result.replace(new RegExp(`\\b${phrase}\\b`, "gi"), translation[language]);
  }

  const translated = result
    .split(/(\s+|[.,;:+/&()!?-])/)
    .map((token) => {
      if (!token) return "";
      const translation = WORDS[token.toLowerCase()]?.[language];
      if (!translation) return token;

      const firstCharacter = token.charAt(0);
      return firstCharacter === firstCharacter.toUpperCase() &&
        firstCharacter !== firstCharacter.toLowerCase()
        ? translation.charAt(0).toUpperCase() + translation.slice(1)
        : translation.toLowerCase();
    })
    .join("");

  return language === "en"
    ? translated.replace(/\bof of\b/gi, "of").replace(/\bwith with\b/gi, "with")
    : translated;
}

export function autoTranslateProduct(name: string, description?: string | null) {
  const enName = translateText(name, "en") || name;
  const esName = translateText(name, "es") || name;

  return {
    en: {
      name: enName,
      description: description
        ? translateText(description, "en")
        : `Delicious ${enName.toLowerCase()} freshly prepared.`,
    },
    es: {
      name: esName,
      description: description
        ? translateText(description, "es")
        : `Delicioso plato de ${esName.toLowerCase()} recién preparado.`,
    },
  };
}
