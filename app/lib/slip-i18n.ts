// Printed-slip wording per language (Pro and Business; see planSlipOptions).
// Pure — the in-app preview renders with it too. Only what prints on the
// slip is translated: the admin UI, the customer list and the one-line
// summary metafield stay English.
//
// Weather conditions come from the provider in English and are saved that
// way on orders (the cache is shared across shops), so they're translated
// at render: the label is mapped to one of CONDITIONS by keyword. A label
// that matches nothing prints as the provider wrote it.
//
// Adding a language: one entry in SLIP_LANGUAGES, one in STRINGS, one
// column in CONDITIONS.

export type SlipLanguage = "en" | "fr" | "de" | "es" | "it" | "pt" | "nl";

export const SLIP_LANGUAGES: { id: SlipLanguage; label: string; locale: string }[] = [
  // en-GB dates ("Thu 17 Oct") were the slip's format before languages existed.
  { id: "en", label: "English", locale: "en-GB" },
  { id: "fr", label: "Français (French)", locale: "fr-FR" },
  { id: "de", label: "Deutsch (German)", locale: "de-DE" },
  { id: "es", label: "Español (Spanish)", locale: "es-ES" },
  { id: "it", label: "Italiano (Italian)", locale: "it-IT" },
  { id: "pt", label: "Português (Portuguese)", locale: "pt-BR" },
  { id: "nl", label: "Nederlands (Dutch)", locale: "nl-NL" },
];

export const isSlipLanguage = (v: unknown): v is SlipLanguage => SLIP_LANGUAGES.some((l) => l.id === v);

export const slipLocale = (lang: SlipLanguage): string =>
  (SLIP_LANGUAGES.find((l) => l.id === lang) ?? SLIP_LANGUAGES[0]!).locale;

export interface SlipStrings {
  packingSlip: string;
  packingSlipReceipt: string;
  order: string;
  shipTo: string;
  billTo: string;
  noAddress: string;
  phone: string;
  email: string;
  payment: string;
  paymentStatus: Record<string, string>;
  distance: string;
  from: string;
  straightLine: string;
  notAvailable: string;
  dispatch: string;
  estimatedDelivery: string;
  delivery: string;
  weatherForecast: string;
  forecast: string;
  destination: string;
  nowTitle: string;
  nowLower: string;
  rainPct: (n: number) => string;
  day: string;
  weather: string;
  high: string;
  low: string;
  rain: string;
  forecastAsOf: string;
  noForecastDays: string;
  limitReached: string;
  noLocation: string;
  unavailable: string;
  beyondRange: (delivery: string, horizonEnd: string) => string;
  deliveryPassed: string;
  orderDetails: string;
  items: (n: number) => string;
  itemsHeading: string;
  item: string;
  price: string;
  quantity: string;
  total: string;
  noImage: string;
  qtyOf: (qty: number, ordered: number) => string;
  vendor: string;
  sku: string;
  barcode: string;
  additionalDetails: string;
  orderNote: string;
  subtotal: string;
  discounts: string;
  shipping: string;
  tax: string;
  thanks: string;
  /** Bad-weather warnings on the dispatch/delivery days. */
  warnRain: string;
  warnFreezing: string;
  warnHot: string;
  /** One-line advice under the forecast when delivery day looks bad. */
  tipRain: string;
  tipFreezing: string;
  tipHot: string;
}

const STRINGS: Record<SlipLanguage, SlipStrings> = {
  en: {
    packingSlip: "Packing slip",
    packingSlipReceipt: "Packing slip & receipt",
    order: "Order",
    shipTo: "Ship to",
    billTo: "Bill to",
    noAddress: "No address",
    phone: "Phone",
    email: "Email",
    payment: "Payment",
    paymentStatus: {
      PAID: "Paid",
      PENDING: "Payment pending",
      AUTHORIZED: "Authorized",
      PARTIALLY_PAID: "Partially paid",
      PARTIALLY_REFUNDED: "Partially refunded",
      REFUNDED: "Refunded",
      VOIDED: "Voided",
      EXPIRED: "Expired",
    },
    distance: "Distance",
    from: "from",
    straightLine: "straight line",
    notAvailable: "not available",
    dispatch: "Dispatch",
    estimatedDelivery: "Estimated delivery",
    delivery: "Delivery",
    weatherForecast: "Weather forecast",
    forecast: "Forecast",
    destination: "destination",
    nowTitle: "Now",
    nowLower: "now",
    rainPct: (n) => `${n}% chance of rain`,
    day: "Day",
    weather: "Weather",
    high: "High",
    low: "Low",
    rain: "Rain chance",
    forecastAsOf: "Forecast as of",
    noForecastDays: "No forecast days available.",
    limitReached: "Weather not included: this month's plan limit is reached.",
    noLocation: "Weather not available: no shipping destination.",
    unavailable: "Weather temporarily unavailable.",
    beyondRange: (d, h) => `Delivery day (${d}) is beyond the forecast range (to ${h}).`,
    deliveryPassed: "Estimated delivery date has passed.",
    orderDetails: "Order details",
    items: (n) => (n === 1 ? "item" : "items"),
    itemsHeading: "Items",
    item: "Item",
    price: "Price",
    quantity: "Quantity",
    total: "Total",
    noImage: "No image",
    qtyOf: (q, t) => `${q} of ${t}`,
    vendor: "Vendor",
    sku: "SKU",
    barcode: "Barcode",
    additionalDetails: "Additional details",
    orderNote: "Order note",
    subtotal: "Subtotal",
    discounts: "Discounts",
    shipping: "Shipping",
    tax: "Tax",
    thanks: "Thank you for shopping with us!",
    warnRain: "Rain likely",
    warnFreezing: "Freezing",
    warnHot: "Very hot",
    tipRain: "Rain expected on delivery day: please bring the parcel in quickly.",
    tipFreezing: "Freezing temperatures on delivery day: please bring the parcel indoors promptly.",
    tipHot: "Very hot on delivery day: please keep the parcel out of direct sun.",
  },
  fr: {
    packingSlip: "Bon de livraison",
    packingSlipReceipt: "Bon de livraison et reçu",
    order: "Commande",
    shipTo: "Livrer à",
    billTo: "Facturer à",
    noAddress: "Aucune adresse",
    phone: "Téléphone",
    email: "E-mail",
    payment: "Paiement",
    paymentStatus: {
      PAID: "Payé",
      PENDING: "Paiement en attente",
      AUTHORIZED: "Autorisé",
      PARTIALLY_PAID: "Partiellement payé",
      PARTIALLY_REFUNDED: "Partiellement remboursé",
      REFUNDED: "Remboursé",
      VOIDED: "Annulé",
      EXPIRED: "Expiré",
    },
    distance: "Distance",
    from: "depuis",
    straightLine: "à vol d'oiseau",
    notAvailable: "non disponible",
    dispatch: "Expédition",
    estimatedDelivery: "Livraison estimée",
    delivery: "Livraison",
    weatherForecast: "Prévisions météo",
    forecast: "Prévisions",
    destination: "destination",
    nowTitle: "Maintenant",
    nowLower: "maintenant",
    rainPct: (n) => `${n} % de risque de pluie`,
    day: "Jour",
    weather: "Météo",
    high: "Max.",
    low: "Min.",
    rain: "Risque de pluie",
    forecastAsOf: "Prévisions du",
    noForecastDays: "Aucune prévision disponible.",
    limitReached: "Météo non incluse : la limite mensuelle du forfait est atteinte.",
    noLocation: "Météo non disponible : aucune adresse de livraison.",
    unavailable: "Météo momentanément indisponible.",
    beyondRange: (d, h) => `Le jour de livraison (${d}) est au-delà de la période de prévision (jusqu'au ${h}).`,
    deliveryPassed: "La date de livraison estimée est passée.",
    orderDetails: "Détails de la commande",
    items: (n) => (n === 1 ? "article" : "articles"),
    itemsHeading: "Articles",
    item: "Article",
    price: "Prix",
    quantity: "Quantité",
    total: "Total",
    noImage: "Pas d'image",
    qtyOf: (q, t) => `${q} sur ${t}`,
    vendor: "Fournisseur",
    sku: "Réf.",
    barcode: "Code-barres",
    additionalDetails: "Informations complémentaires",
    orderNote: "Note de commande",
    subtotal: "Sous-total",
    discounts: "Réductions",
    shipping: "Frais de port",
    tax: "Taxes",
    thanks: "Merci pour votre achat !",
    warnRain: "Pluie probable",
    warnFreezing: "Gel",
    warnHot: "Très chaud",
    tipRain: "Pluie prévue le jour de la livraison : merci de rentrer le colis rapidement.",
    tipFreezing: "Gel prévu le jour de la livraison : merci de rentrer le colis rapidement.",
    tipHot: "Forte chaleur le jour de la livraison : merci de garder le colis à l'abri du soleil.",
  },
  de: {
    packingSlip: "Lieferschein",
    packingSlipReceipt: "Lieferschein & Quittung",
    order: "Bestellung",
    shipTo: "Lieferadresse",
    billTo: "Rechnungsadresse",
    noAddress: "Keine Adresse",
    phone: "Telefon",
    email: "E-Mail",
    payment: "Zahlung",
    paymentStatus: {
      PAID: "Bezahlt",
      PENDING: "Zahlung ausstehend",
      AUTHORIZED: "Autorisiert",
      PARTIALLY_PAID: "Teilweise bezahlt",
      PARTIALLY_REFUNDED: "Teilweise erstattet",
      REFUNDED: "Erstattet",
      VOIDED: "Storniert",
      EXPIRED: "Abgelaufen",
    },
    distance: "Entfernung",
    from: "von",
    straightLine: "Luftlinie",
    notAvailable: "nicht verfügbar",
    dispatch: "Versand",
    estimatedDelivery: "Voraussichtliche Zustellung",
    delivery: "Zustellung",
    weatherForecast: "Wettervorhersage",
    forecast: "Vorhersage",
    destination: "Zielort",
    nowTitle: "Jetzt",
    nowLower: "jetzt",
    rainPct: (n) => `${n} % Regenwahrscheinlichkeit`,
    day: "Tag",
    weather: "Wetter",
    high: "Max.",
    low: "Min.",
    rain: "Regenrisiko",
    forecastAsOf: "Vorhersage vom",
    noForecastDays: "Keine Vorhersage verfügbar.",
    limitReached: "Ohne Wetter: Das Monatslimit des Tarifs ist erreicht.",
    noLocation: "Kein Wetter verfügbar: keine Lieferadresse.",
    unavailable: "Wetter vorübergehend nicht verfügbar.",
    beyondRange: (d, h) => `Der Zustelltag (${d}) liegt außerhalb des Vorhersagezeitraums (bis ${h}).`,
    deliveryPassed: "Das voraussichtliche Zustelldatum ist bereits vorbei.",
    orderDetails: "Bestelldetails",
    items: () => "Artikel",
    itemsHeading: "Artikel",
    item: "Artikel",
    price: "Preis",
    quantity: "Menge",
    total: "Gesamt",
    noImage: "Kein Bild",
    qtyOf: (q, t) => `${q} von ${t}`,
    vendor: "Anbieter",
    sku: "Art.-Nr.",
    barcode: "Barcode",
    additionalDetails: "Weitere Angaben",
    orderNote: "Bestellnotiz",
    subtotal: "Zwischensumme",
    discounts: "Rabatte",
    shipping: "Versand",
    tax: "Steuern",
    thanks: "Vielen Dank für Ihren Einkauf!",
    warnRain: "Regen wahrscheinlich",
    warnFreezing: "Frost",
    warnHot: "Sehr heiß",
    tipRain: "Am Liefertag wird Regen erwartet: Bitte holen Sie das Paket schnell herein.",
    tipFreezing: "Am Liefertag wird Frost erwartet: Bitte holen Sie das Paket schnell ins Haus.",
    tipHot: "Am Liefertag wird es sehr heiß: Bitte lassen Sie das Paket nicht in der Sonne stehen.",
  },
  es: {
    packingSlip: "Albarán",
    packingSlipReceipt: "Albarán y recibo",
    order: "Pedido",
    shipTo: "Enviar a",
    billTo: "Facturar a",
    noAddress: "Sin dirección",
    phone: "Teléfono",
    email: "Correo electrónico",
    payment: "Pago",
    paymentStatus: {
      PAID: "Pagado",
      PENDING: "Pago pendiente",
      AUTHORIZED: "Autorizado",
      PARTIALLY_PAID: "Pagado parcialmente",
      PARTIALLY_REFUNDED: "Reembolsado parcialmente",
      REFUNDED: "Reembolsado",
      VOIDED: "Anulado",
      EXPIRED: "Caducado",
    },
    distance: "Distancia",
    from: "desde",
    straightLine: "en línea recta",
    notAvailable: "no disponible",
    dispatch: "Envío",
    estimatedDelivery: "Entrega estimada",
    delivery: "Entrega",
    weatherForecast: "Previsión del tiempo",
    forecast: "Previsión",
    destination: "destino",
    nowTitle: "Ahora",
    nowLower: "ahora",
    rainPct: (n) => `${n} % de probabilidad de lluvia`,
    day: "Día",
    weather: "Tiempo",
    high: "Máx.",
    low: "Mín.",
    rain: "Prob. de lluvia",
    forecastAsOf: "Previsión del",
    noForecastDays: "No hay previsión disponible.",
    limitReached: "Tiempo no incluido: se ha alcanzado el límite mensual del plan.",
    noLocation: "Tiempo no disponible: no hay dirección de envío.",
    unavailable: "Tiempo no disponible temporalmente.",
    beyondRange: (d, h) => `El día de entrega (${d}) está fuera del periodo de previsión (hasta ${h}).`,
    deliveryPassed: "La fecha de entrega estimada ya ha pasado.",
    orderDetails: "Detalles del pedido",
    items: (n) => (n === 1 ? "artículo" : "artículos"),
    itemsHeading: "Artículos",
    item: "Artículo",
    price: "Precio",
    quantity: "Cantidad",
    total: "Total",
    noImage: "Sin imagen",
    qtyOf: (q, t) => `${q} de ${t}`,
    vendor: "Proveedor",
    sku: "SKU",
    barcode: "Código de barras",
    additionalDetails: "Información adicional",
    orderNote: "Nota del pedido",
    subtotal: "Subtotal",
    discounts: "Descuentos",
    shipping: "Envío",
    tax: "Impuestos",
    thanks: "¡Gracias por tu compra!",
    warnRain: "Lluvia probable",
    warnFreezing: "Helada",
    warnHot: "Mucho calor",
    tipRain: "Se espera lluvia el día de la entrega: recoge el paquete cuanto antes.",
    tipFreezing: "Se esperan heladas el día de la entrega: lleva el paquete al interior cuanto antes.",
    tipHot: "Hará mucho calor el día de la entrega: mantén el paquete alejado del sol.",
  },
  it: {
    packingSlip: "Distinta di imballaggio",
    packingSlipReceipt: "Distinta di imballaggio e ricevuta",
    order: "Ordine",
    shipTo: "Spedire a",
    billTo: "Fatturare a",
    noAddress: "Nessun indirizzo",
    phone: "Telefono",
    email: "Email",
    payment: "Pagamento",
    paymentStatus: {
      PAID: "Pagato",
      PENDING: "Pagamento in sospeso",
      AUTHORIZED: "Autorizzato",
      PARTIALLY_PAID: "Parzialmente pagato",
      PARTIALLY_REFUNDED: "Parzialmente rimborsato",
      REFUNDED: "Rimborsato",
      VOIDED: "Annullato",
      EXPIRED: "Scaduto",
    },
    distance: "Distanza",
    from: "da",
    straightLine: "in linea d'aria",
    notAvailable: "non disponibile",
    dispatch: "Spedizione",
    estimatedDelivery: "Consegna prevista",
    delivery: "Consegna",
    weatherForecast: "Previsioni meteo",
    forecast: "Previsioni",
    destination: "destinazione",
    nowTitle: "Ora",
    nowLower: "ora",
    rainPct: (n) => `${n}% probabilità di pioggia`,
    day: "Giorno",
    weather: "Meteo",
    high: "Max",
    low: "Min",
    rain: "Prob. pioggia",
    forecastAsOf: "Previsioni del",
    noForecastDays: "Nessuna previsione disponibile.",
    limitReached: "Meteo non incluso: è stato raggiunto il limite mensile del piano.",
    noLocation: "Meteo non disponibile: nessun indirizzo di spedizione.",
    unavailable: "Meteo temporaneamente non disponibile.",
    beyondRange: (d, h) => `Il giorno di consegna (${d}) è oltre il periodo di previsione (fino a ${h}).`,
    deliveryPassed: "La data di consegna prevista è già passata.",
    orderDetails: "Dettagli dell'ordine",
    items: (n) => (n === 1 ? "articolo" : "articoli"),
    itemsHeading: "Articoli",
    item: "Articolo",
    price: "Prezzo",
    quantity: "Quantità",
    total: "Totale",
    noImage: "Nessuna immagine",
    qtyOf: (q, t) => `${q} di ${t}`,
    vendor: "Fornitore",
    sku: "SKU",
    barcode: "Codice a barre",
    additionalDetails: "Dettagli aggiuntivi",
    orderNote: "Nota dell'ordine",
    subtotal: "Subtotale",
    discounts: "Sconti",
    shipping: "Spedizione",
    tax: "Imposte",
    thanks: "Grazie per il tuo acquisto!",
    warnRain: "Pioggia probabile",
    warnFreezing: "Gelo",
    warnHot: "Molto caldo",
    tipRain: "Pioggia prevista il giorno della consegna: ritira il pacco al più presto.",
    tipFreezing: "Gelo previsto il giorno della consegna: porta il pacco al chiuso al più presto.",
    tipHot: "Caldo intenso il giorno della consegna: tieni il pacco lontano dal sole.",
  },
  pt: {
    packingSlip: "Guia de remessa",
    packingSlipReceipt: "Guia de remessa e recibo",
    order: "Pedido",
    shipTo: "Enviar para",
    billTo: "Faturar para",
    noAddress: "Sem endereço",
    phone: "Telefone",
    email: "E-mail",
    payment: "Pagamento",
    paymentStatus: {
      PAID: "Pago",
      PENDING: "Pagamento pendente",
      AUTHORIZED: "Autorizado",
      PARTIALLY_PAID: "Parcialmente pago",
      PARTIALLY_REFUNDED: "Parcialmente reembolsado",
      REFUNDED: "Reembolsado",
      VOIDED: "Cancelado",
      EXPIRED: "Expirado",
    },
    distance: "Distância",
    from: "de",
    straightLine: "em linha reta",
    notAvailable: "indisponível",
    dispatch: "Envio",
    estimatedDelivery: "Entrega estimada",
    delivery: "Entrega",
    weatherForecast: "Previsão do tempo",
    forecast: "Previsão",
    destination: "destino",
    nowTitle: "Agora",
    nowLower: "agora",
    rainPct: (n) => `${n}% de chance de chuva`,
    day: "Dia",
    weather: "Tempo",
    high: "Máx.",
    low: "Mín.",
    rain: "Chance de chuva",
    forecastAsOf: "Previsão de",
    noForecastDays: "Nenhuma previsão disponível.",
    limitReached: "Previsão não incluída: o limite mensal do plano foi atingido.",
    noLocation: "Previsão indisponível: sem endereço de entrega.",
    unavailable: "Previsão temporariamente indisponível.",
    beyondRange: (d, h) => `O dia da entrega (${d}) está além do período da previsão (até ${h}).`,
    deliveryPassed: "A data estimada de entrega já passou.",
    orderDetails: "Detalhes do pedido",
    items: (n) => (n === 1 ? "item" : "itens"),
    itemsHeading: "Itens",
    item: "Item",
    price: "Preço",
    quantity: "Quantidade",
    total: "Total",
    noImage: "Sem imagem",
    qtyOf: (q, t) => `${q} de ${t}`,
    vendor: "Fornecedor",
    sku: "SKU",
    barcode: "Código de barras",
    additionalDetails: "Informações adicionais",
    orderNote: "Observação do pedido",
    subtotal: "Subtotal",
    discounts: "Descontos",
    shipping: "Frete",
    tax: "Impostos",
    thanks: "Obrigado pela sua compra!",
    warnRain: "Chuva provável",
    warnFreezing: "Congelante",
    warnHot: "Muito quente",
    tipRain: "Previsão de chuva no dia da entrega: recolha o pacote o quanto antes.",
    tipFreezing: "Previsão de temperaturas congelantes no dia da entrega: leve o pacote para dentro o quanto antes.",
    tipHot: "Muito calor no dia da entrega: mantenha o pacote longe do sol.",
  },
  nl: {
    packingSlip: "Pakbon",
    packingSlipReceipt: "Pakbon en kassabon",
    order: "Bestelling",
    shipTo: "Verzenden naar",
    billTo: "Factureren aan",
    noAddress: "Geen adres",
    phone: "Telefoon",
    email: "E-mail",
    payment: "Betaling",
    paymentStatus: {
      PAID: "Betaald",
      PENDING: "Betaling in behandeling",
      AUTHORIZED: "Geautoriseerd",
      PARTIALLY_PAID: "Gedeeltelijk betaald",
      PARTIALLY_REFUNDED: "Gedeeltelijk terugbetaald",
      REFUNDED: "Terugbetaald",
      VOIDED: "Geannuleerd",
      EXPIRED: "Verlopen",
    },
    distance: "Afstand",
    from: "vanaf",
    straightLine: "hemelsbreed",
    notAvailable: "niet beschikbaar",
    dispatch: "Verzending",
    estimatedDelivery: "Verwachte levering",
    delivery: "Levering",
    weatherForecast: "Weersverwachting",
    forecast: "Verwachting",
    destination: "bestemming",
    nowTitle: "Nu",
    nowLower: "nu",
    rainPct: (n) => `${n}% kans op regen`,
    day: "Dag",
    weather: "Weer",
    high: "Max.",
    low: "Min.",
    rain: "Kans op regen",
    forecastAsOf: "Verwachting van",
    noForecastDays: "Geen verwachting beschikbaar.",
    limitReached: "Geen weer: de maandlimiet van het abonnement is bereikt.",
    noLocation: "Geen weer beschikbaar: geen verzendadres.",
    unavailable: "Weer tijdelijk niet beschikbaar.",
    beyondRange: (d, h) => `De leverdag (${d}) valt buiten de verwachtingsperiode (tot ${h}).`,
    deliveryPassed: "De verwachte leverdatum is verstreken.",
    orderDetails: "Bestelgegevens",
    items: (n) => (n === 1 ? "artikel" : "artikelen"),
    itemsHeading: "Artikelen",
    item: "Artikel",
    price: "Prijs",
    quantity: "Aantal",
    total: "Totaal",
    noImage: "Geen afbeelding",
    qtyOf: (q, t) => `${q} van ${t}`,
    vendor: "Leverancier",
    sku: "SKU",
    barcode: "Barcode",
    additionalDetails: "Aanvullende gegevens",
    orderNote: "Opmerking bij bestelling",
    subtotal: "Subtotaal",
    discounts: "Kortingen",
    shipping: "Verzending",
    tax: "Btw",
    thanks: "Bedankt voor je aankoop!",
    warnRain: "Kans op regen",
    warnFreezing: "Vorst",
    warnHot: "Zeer heet",
    tipRain: "Regen verwacht op de leverdag: haal het pakket snel naar binnen.",
    tipFreezing: "Vorst verwacht op de leverdag: haal het pakket snel naar binnen.",
    tipHot: "Zeer heet op de leverdag: houd het pakket uit de zon.",
  },
};

export const slipStrings = (lang: SlipLanguage): SlipStrings => STRINGS[lang] ?? STRINGS.en;

// ---------- weather conditions ----------

type Condition =
  | "clear" | "mostlyClear" | "partlyCloudy" | "cloudy" | "overcast"
  | "fog" | "mist" | "haze" | "smoke" | "dust" | "ash"
  | "lightDrizzle" | "drizzle" | "heavyDrizzle"
  | "lightRain" | "rain" | "heavyRain" | "freezingRain"
  | "showers" | "heavyShowers" | "sleet"
  | "lightSnow" | "snow" | "heavySnow" | "snowShowers"
  | "thunderstorm" | "thunderHail" | "squalls" | "tornado";

// Columns: fr, de, es, it, pt, nl (English keeps the provider's own label).
const CONDITIONS: Record<Condition, [string, string, string, string, string, string]> = {
  clear: ["Dégagé", "Klar", "Despejado", "Sereno", "Céu limpo", "Helder"],
  mostlyClear: ["Plutôt dégagé", "Überwiegend klar", "Mayormente despejado", "Prevalentemente sereno", "Predominantemente limpo", "Overwegend helder"],
  partlyCloudy: ["Partiellement nuageux", "Teilweise bewölkt", "Parcialmente nublado", "Parzialmente nuvoloso", "Parcialmente nublado", "Half bewolkt"],
  cloudy: ["Nuageux", "Bewölkt", "Nublado", "Nuvoloso", "Nublado", "Bewolkt"],
  overcast: ["Couvert", "Bedeckt", "Cubierto", "Coperto", "Encoberto", "Zwaar bewolkt"],
  fog: ["Brouillard", "Nebel", "Niebla", "Nebbia", "Nevoeiro", "Mist"],
  mist: ["Brume", "Dunst", "Neblina", "Foschia", "Névoa", "Nevel"],
  haze: ["Brume sèche", "Dunst", "Calima", "Foschia", "Névoa seca", "Nevel"],
  smoke: ["Fumée", "Rauch", "Humo", "Fumo", "Fumaça", "Rook"],
  dust: ["Poussière", "Staub", "Polvo", "Polvere", "Poeira", "Stof"],
  ash: ["Cendres volcaniques", "Vulkanasche", "Ceniza volcánica", "Cenere vulcanica", "Cinza vulcânica", "Vulkanische as"],
  lightDrizzle: ["Bruine légère", "Leichter Nieselregen", "Llovizna ligera", "Pioggerella leggera", "Garoa fraca", "Lichte motregen"],
  drizzle: ["Bruine", "Nieselregen", "Llovizna", "Pioggerella", "Garoa", "Motregen"],
  heavyDrizzle: ["Forte bruine", "Starker Nieselregen", "Llovizna intensa", "Pioggerella intensa", "Garoa forte", "Zware motregen"],
  lightRain: ["Pluie légère", "Leichter Regen", "Lluvia ligera", "Pioggia leggera", "Chuva fraca", "Lichte regen"],
  rain: ["Pluie", "Regen", "Lluvia", "Pioggia", "Chuva", "Regen"],
  heavyRain: ["Forte pluie", "Starker Regen", "Lluvia intensa", "Pioggia intensa", "Chuva forte", "Zware regen"],
  freezingRain: ["Pluie verglaçante", "Gefrierender Regen", "Lluvia helada", "Pioggia gelata", "Chuva congelada", "IJzel"],
  showers: ["Averses", "Schauer", "Chubascos", "Rovesci", "Pancadas de chuva", "Buien"],
  heavyShowers: ["Fortes averses", "Starke Schauer", "Chubascos fuertes", "Forti rovesci", "Pancadas fortes", "Zware buien"],
  sleet: ["Neige fondue", "Schneeregen", "Aguanieve", "Nevischio", "Chuva com neve", "Natte sneeuw"],
  lightSnow: ["Neige légère", "Leichter Schneefall", "Nieve ligera", "Neve leggera", "Neve fraca", "Lichte sneeuw"],
  snow: ["Neige", "Schnee", "Nieve", "Neve", "Neve", "Sneeuw"],
  heavySnow: ["Fortes chutes de neige", "Starker Schneefall", "Nevada intensa", "Neve intensa", "Neve forte", "Zware sneeuwval"],
  snowShowers: ["Averses de neige", "Schneeschauer", "Chubascos de nieve", "Rovesci di neve", "Pancadas de neve", "Sneeuwbuien"],
  thunderstorm: ["Orage", "Gewitter", "Tormenta", "Temporale", "Trovoada", "Onweer"],
  thunderHail: ["Orage, grêle", "Gewitter, Hagel", "Tormenta con granizo", "Temporale con grandine", "Trovoada com granizo", "Onweer met hagel"],
  squalls: ["Rafales", "Böen", "Rachas de viento", "Raffiche", "Rajadas", "Windstoten"],
  tornado: ["Tornade", "Tornado", "Tornado", "Tornado", "Tornado", "Tornado"],
};

const COLUMN: Record<Exclude<SlipLanguage, "en">, number> = { fr: 0, de: 1, es: 2, it: 3, pt: 4, nl: 5 };

/** OpenWeather descriptions and WMO labels (wmo.ts) → one condition. */
export function conditionOf(label: string): Condition | null {
  const l = label.toLowerCase();
  const heavy = /heavy|very|extreme/.test(l);
  const light = /light/.test(l);
  if (/tornado/.test(l)) return "tornado";
  if (/squall/.test(l)) return "squalls";
  if (/thunder|storm/.test(l)) return /hail/.test(l) ? "thunderHail" : "thunderstorm";
  if (/sleet|rain and snow/.test(l)) return "sleet";
  if (/snow/.test(l)) return /shower/.test(l) ? "snowShowers" : heavy ? "heavySnow" : light ? "lightSnow" : "snow";
  if (/freezing (rain|drizzle)/.test(l)) return "freezingRain";
  if (/shower/.test(l)) return heavy ? "heavyShowers" : "showers";
  if (/drizzle/.test(l)) return heavy ? "heavyDrizzle" : light ? "lightDrizzle" : "drizzle";
  if (/rain/.test(l)) return heavy ? "heavyRain" : light ? "lightRain" : "rain";
  if (/fog/.test(l)) return "fog";
  if (/mist/.test(l)) return "mist";
  if (/haze/.test(l)) return "haze";
  if (/smoke/.test(l)) return "smoke";
  if (/ash/.test(l)) return "ash";
  if (/dust|sand/.test(l)) return "dust";
  if (/overcast/.test(l)) return "overcast";
  if (/mostly clear/.test(l)) return "mostlyClear";
  if (/few|scattered|partly/.test(l)) return "partlyCloudy";
  if (/broken|cloud/.test(l)) return "cloudy";
  if (/clear/.test(l)) return "clear";
  return null;
}

/** A provider's condition label in the slip's language. */
export function conditionLabel(label: string, lang: SlipLanguage): string {
  if (lang === "en") return label;
  const c = conditionOf(label);
  return c ? CONDITIONS[c][COLUMN[lang]] : label;
}
