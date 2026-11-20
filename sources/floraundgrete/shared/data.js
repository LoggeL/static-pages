// Cathrin Raasch Atelier – gemeinsame Inhalte für Website und Verwaltung.
// Quelle: öffentlicher Etsy-Shop https://www.etsy.com/de/shop/FloraundGrete (Stand 19.11.2026).
// Bilder liegen in img/<datei>.webp.

export const SHOP = {
 name: "Cathrin Raasch Atelier",
 claim: "Handgemachte Einzelstücke",
 tagline: "Vintage-inspirierte Kleidung, mit Hand und Herz genäht im Mini-Atelier mitten in der Pfalz.",
 owner: "Cathrin",
 ownerRole: "Schneiderin mit Herz und Seele",
 place: "Ramsen",
 region: "Pfalz, Rheinland-Pfalz",
 postalCode: "67305",
 country: "DE",
 etsy: "https://www.etsy.com/de/shop/FloraundGrete",
 etsyReviews: "https://www.etsy.com/de/shop/FloraundGrete#reviews",
 instagram: "https://www.instagram.com/cathrinraasch.atelier/",
 instagramHandle: "@cathrinraasch.atelier",
 since: 2021,
 announcement:
 "Alle Teile entstehen in meinem Mini-Atelier mitten in der Pfalz, mit Hand und Herz. Viele sind aus oder mit originalen Vintage-Stoffen genäht, echte Einzelstücke, die nur du allein tragen kannst.",
 packaging:
 "Der Umwelt zuliebe verschicke ich dein Päckchen plastikfrei.",
 custom:
 "Du hast einen besonderen Wunsch bei Stoff, Größe oder Länge? Schreib mir gern, ich schaue nach Möglichkeiten!",
 logo: "logo-white.webp", // hell & freigestellt; dunkel: logo-ink.webp, quadratisch: logo.png
 banner: "shop-banner.webp",
 portrait: "member-1.webp", // Schwarz-Weiß-Porträt von Cathrin (Etsy-Shopprofil)
 portraitSmall: "cathrin-avatar.webp",
 portraitColor: "rosemary-6.webp", // Cathrin im Kleid Rosemary
 dog: "member-2.webp", // Struppi
};

// Steckbrief für "Über mich" – Platzhaltertexte auf Basis des Etsy-Profils, von Cathrin anpassbar.
export const ABOUT = {
 headline: "Hi, ich bin Cathrin.",
 intro:
 "In meinem kleinen Atelier in Ramsen nähe ich Röcke, Kleider, Kragen und Accessoires, am liebsten aus Leinen, Musselin und echten Vintage-Stoffen, die schon eine Geschichte erzählen.",
 facts: [
  { label: "Beruf", value: "Schneiderin" },
  { label: "Atelier", value: "Ramsen, Pfalz" },
  { label: "Auf Etsy seit", value: "2021" },
  { label: "Lieblingsstoff", value: "Leinen & alte Bettwäsche" },
  { label: "Lieblingsteil", value: "Rock Lene, seit Jahren mein Alltagsbegleiter" },
  { label: "Assistenz", value: "Struppi, zuständig fürs Auspacken" },
 ],
 values: [
  { title: "Maßgeschneidert", text: "Röcke und Kleider nähe ich auf deine Taille und Wunschlänge." },
  { title: "Vintage-Stoffe", text: "Alte Bettwäsche, Kissenbezüge und Liberty-Drucke bekommen ein zweites Leben." },
  { title: "Ohne Plastik", text: "Plastikfrei verpackt, liebevoll und auf Wunsch als Geschenk." },
 ],
 dogCaption: "Struppi, Assistenz. Hilft dir gern beim Auspacken deiner Bestellung.",
};

export const CATEGORIES = [
 { id: "roecke", label: "Röcke" },
 { id: "kleider", label: "Kleider & Oberteile" },
 { id: "kragen", label: "Wechselkragen" },
 { id: "accessoires", label: "Tücher & Accessoires" },
];

const img = (slug, n) => Array.from({ length: n }, (_, i) => `${slug}-${i + 1}.webp`);
const etsy = (id) => `https://www.etsy.com/de/listing/${id}`;

export const PRODUCTS = [
 {
  id: "lene", etsyId: "1111578564", url: etsy("1111578564"),
  name: "Rock Lene", subtitle: "Leinenrock im Vintage-Stil",
  category: "roecke", price: 65, priceFrom: true, madeToMeasure: true, featured: true,
  colors: ["Natur/Weiß", "Grün", "Lila", "Blau", "Gelb", "Schwarz"],
  material: "Leinen / Viskose-Leinen",
  short: "Knielanger Rock aus Leinen, auf deine Taille genäht, mit großer Seitentasche, Reißverschluss und Knopf.",
  details: [
 "Länge ca. 68 cm, kürzer oder länger möglich",
 "Große Seitentasche – er hat TASCHEN!",
 "Bund innen mit hübschem Schrägband versäubert",
 "Waschbar bis 40 °C, nicht in den Trockner",
  ],
  story: "Lene begleitet mich seit vielen Jahren in vielen Stoffen und Farben durch den Alltag und ist mein absoluter Lieblings-Allrounder. Deshalb gibt es sie jetzt auch für dich.",
  images: img("lene", 10), hero: "lene-1.webp",
 },
 {
  id: "millie", etsyId: "1512585340", url: etsy("1512585340"),
  name: "Musselinrock Millie", subtitle: "Leichter Sommerrock mit Knopfleiste",
  category: "roecke", price: 49.9, freeShipping: true, madeToMeasure: true, featured: true,
  colors: ["Weinrot", "Grau", "Schwarz", "Heide"],
  material: "Baumwoll-Musselin",
  short: "Federleichter Musselinrock mit Gummibund, Zierknopfleiste und Seitentasche, auf deine Taille genäht.",
  details: [
 "Länge ca. 68 cm, kürzer oder länger möglich",
 "Gummibund, Knopfleiste ist eine Zierleiste",
 "Trocknet super schnell – Wash & Wear",
 "Waschbar bis 40 °C",
  ],
  story: "Meine Musselinröcke trage ich seit Jahren mindestens einmal pro Woche direkt nach dem Waschen. Wash & Wear zu 100 %.",
  images: img("millie", 7), hero: "millie-1.webp",
 },
 {
  id: "viola-rock", etsyId: "1513137828", url: etsy("1513137828"),
  name: "Rock Viola", subtitle: "Echter Vintage-Stoff aus alter Bettwäsche",
  category: "roecke", price: 45, unique: true,
  colors: ["Mint mit Blumen"],
  material: "100 % Baumwolle, Vintage-Stoff",
  short: "Aus echtem Vintage-Stoff, inklusive der originalen Knopfleiste der früheren Bettwäsche. Gute Laune in Rockform.",
  details: ["Für 75–91 cm Taillenumfang", "Rocklänge 68 cm", "Gummibund", "Waschbar bis 40 °C"],
  images: img("viola-rock", 5), hero: "viola-rock-1.webp",
 },
 {
  id: "viola-kleid", etsyId: "1526791039", url: etsy("1526791039"),
  name: "Kleid Viola", subtitle: "Aus echter Vintage-Bettwäsche, M–XL",
  category: "kleider", price: 79, freeShipping: true, unique: true, featured: true,
  colors: ["Mint mit Blumen"],
  material: "100 % Baumwolle, Vintage-Stoff",
  short: "A-Linien-Kleid mit Rüschensaum, Seitentasche und Schlaufenträgern zum Binden, aus einem echten Vintage-Schätzchen.",
  details: ["Reißverschluss in der Seitennaht", "Größe über die Schlaufen anpassbar (M–XL)", "Länge 90 cm ab Ausschnitt", "Feinwäsche bis 40 °C"],
  images: img("viola-kleid", 7), hero: "viola-kleid-3.webp",
 },
 {
  id: "rosemary", etsyId: "1125591835", url: etsy("1125591835"),
  name: "Kleid Rosemary", subtitle: "Leinenkleid, XS–4X",
  category: "kleider", price: 95, madeToMeasure: true, featured: true,
  colors: ["Grau (Vintage, Gr. L)", "Flaschengrün", "Flieder", "Senfgelb", "Navy"],
  material: "Leinen/Baumwolle bzw. Leinen-Viskose",
  short: "A-Linien-Kleid mit gekräuseltem Rock und Seitentasche. Das graue war früher ein Bettbezug, die anderen Farben nähe ich auf Maß.",
  details: ["Reißverschluss in der Seitennaht", "Ausschnitt mit Beleg und Schrägband", "Nähzeit 1–2 Wochen", "Im Winter mit Shirt oder Cardigan"],
  images: img("rosemary", 10), hero: "rosemary-2.webp",
 },
 {
  id: "eloise", etsyId: "1111592794", url: etsy("1111592794"),
  name: "Crop-Top Eloise", subtitle: "Aus einem Vintage-Kissenbezug",
  category: "kleider", price: 42, unique: true,
  colors: ["Weiß mit Rosen"],
  material: "100 % Baumwolle",
  short: "Einzelstück aus einem originalen Vintage-Kissenbezug, mit Tropfenausschnitt, Schleife im Rücken und kleinen Rüschenärmeln.",
  details: ["Größe EU 42", "Einzelstück", "Feinwäsche bis 40 °C"],
  images: img("eloise", 6), hero: "eloise-2.webp",
 },
 {
  id: "kragen-betsy", etsyId: "1139706973", url: etsy("1139706973"),
  name: "Wendekragen Betsy", subtitle: "Liberty Tana Lawn, Millefleur",
  category: "kragen", price: 27,
  material: "100 % Baumwolle",
  short: "Wendekragen mit Rüsche: eine Seite Liberty-Blümchen, die andere echter Vintage-Stoff. Macht jeden Pulli besonders.",
  details: ["Wendbar", "Handwäsche", "Schnitt von @meandkiddo.patterns"],
  images: img("kragen-betsy", 7), hero: "kragen-betsy-7.webp",
 },
 {
  id: "kragen-frucht", etsyId: "1139712447", url: etsy("1139712447"),
  name: "Wendekragen Forbidden Fruit", subtitle: "Liberty-Druck, Rüschenkragen",
  category: "kragen", price: 27,
  material: "100 % Baumwolle",
  short: "Liberty Tana Lawn mit Früchten und Blüten, Rückseite aus Vintage-Weiß, mit Schleifenbändern.",
  details: ["Wendbar", "Handwäsche"],
  images: img("kragen-frucht", 6), hero: "kragen-frucht-6.webp",
 },
 {
  id: "kragen-karo", etsyId: "1125761228", url: etsy("1125761228"),
  name: "Wendekragen Holiday", subtitle: "Vintage-Karo rot/weiß",
  category: "kragen", price: 24,
  material: "100 % Baumwolle, Vintage",
  short: "Originaler Vintage-Baumwollstoff mit gewebtem Karo, rot und weiß, mit Rüschen.",
  details: ["Wendbar", "Handwäsche"],
  images: img("kragen-karo", 4), hero: "kragen-karo-4.webp",
 },
 {
  id: "tuch-uni", etsyId: "1120733005", url: etsy("1120733005"),
  name: "Musselin-Dreieckstuch XXL", subtitle: "Doppellagig, viele Farben",
  category: "accessoires", price: 29,
  colors: ["Rosa", "Weinrot", "Mint", "Petrol", "Dunkelgrün", "Senf"],
  material: "100 % Baumwolle",
  short: "Großes, doppellagiges Dreieckstuch, gewendet genäht, also ohne offene Kanten. Kuschelig weich.",
  details: ["Waschbar bei 30 °C", "Schönes Wintergeschenk"],
  images: img("tuch-uni", 7), hero: "tuch-uni-2.webp",
 },
 {
  id: "tuch-blumen", etsyId: "1337329930", url: etsy("1337329930"),
  name: "Musselintuch Blumen", subtitle: "XXL-Dreieckstuch mit Blüten",
  category: "accessoires", price: 29,
  material: "100 % Baumwolle",
  short: "Doppellagiges XXL-Tuch mit Blumendruck, superweich und warm.",
  details: ["Waschbar bei 30 °C"],
  images: img("tuch-blumen", 8), hero: "tuch-blumen-1.webp",
 },
 {
  id: "stirnband", etsyId: "1337336466", url: etsy("1337336466"),
  name: "Stirnband Cordoptik", subtitle: "Grau, Schwarz, Dunkelblau",
  category: "accessoires", price: 12,
  material: "Cord-Strick",
  short: "Kuscheliges Stirnband, damit die Ohren immer warm bleiben. Auch ein tolles Weihnachtsgeschenk.",
  details: ["Weitere Farben im Shop"],
  images: img("stirnband", 7), hero: "stirnband-6.webp",
 },
 {
  id: "muetze", etsyId: "1472687336", url: etsy("1472687336"),
  name: "Rippmütze", subtitle: "Unisex, für Kinder & Erwachsene",
  category: "accessoires", price: 17,
  material: "Baumwoll-Rippjersey, doppellagig",
  short: "Der Allrounder: doppellagig, total angenehm, wächst mit und passt auch unter den Helm.",
  details: ["Für Kinder und Erwachsene", "Maße gern in die Anmerkung"],
  images: img("muetze", 7), hero: "muetze-1.webp",
 },
 {
  id: "stulpen", etsyId: "4396882148", url: etsy("4396882148"),
  name: "Walk-Stulpen", subtitle: "Mit Daumenloch, Erwachsene",
  category: "accessoires", price: 15, isNew: true,
  material: "100 % Schurwolle (Walk)",
  short: "Handgemachte Stulpen aus Walkloden: atmungsaktiv, wärmend, leicht wasserabweisend. Handy bedienen ohne auszuziehen.",
  details: ["Einheitsgröße, dehnbar", "Lüften genügt meist", "Handwäsche kalt, liegend trocknen"],
  images: img("stulpen", 14), hero: "stulpen-4.webp",
 },
];

// Ausgewählte echte Etsy-Bewertungen (ins Deutsche zurückübersetzt bzw. Original).
export const REVIEWS = [
 { name: "S.", date: "2026-10-20", product: "stulpen", text: "Warme, hochwertige Stulpen – perfekt für draußen, das Material ist robust und fusselt nicht. Absolute Empfehlung und super schneller Versand.", reply: "Danke für dein Feedback & ganz viel Freude damit ♡" },
 { name: "Monika", date: "2025-11-15", product: "stirnband", text: "Wunderschöne Verarbeitung und so hochwertiges Material " },
 { name: "Laura", date: "2025-02-07", product: "lene", text: "Tolle Verkäuferin, würde wieder kaufen! Der Rock hat eine super Qualität." },
 { name: "Janne", date: "2024-05-06", product: "lene", text: "Das ist schon mein zweiter Lene-Rock und ich kann gar nicht sagen, wie sehr ich ihn liebe. Die Farbe ist wieder traumhaft und er passt perfekt. Ich fühle mich hübsch und gleichzeitig so wohl wie lange nicht.", reply: "Daaaanke ♡" },
 { name: "Daria", date: "2024-07-05", product: "lene", text: "Liebevoll verpackt und nicht nur vom Schnitt, sondern auch vom Material her beeindruckend. Ideal für kühle und auch warme Sommertage!", reply: "Danke für dein tolles Foto und die liebe Bewertung! Ich freu mich total!" },
 { name: "Lisa", date: "2024-07-02", product: "millie", text: "Toller Stoff. Superweich. Passt perfekt.", reply: "Danke dir für die Bewertung ♡" },
 { name: "Marina", date: "2024-06-22", product: "millie", text: "Zufrieden mit dem Produkt und unglaublich liebevoll verpackt. Das hat mir große Freude bereitet. Danke :)", reply: "Vielen vielen Dank für dein Feedback ♡" },
 { name: "Tanja", date: "2024-06-20", product: "millie", text: "Toller Rock, 1a saubere Verarbeitung, liebevoll verpackt, super netter Kontakt. Gern wieder!!", reply: "Tausend Dank für dein Feedback ♡" },
];

export const FAQ = [
 { q: "Kann ich Stoff, Größe oder Länge selbst wählen?", a: "Ja! Röcke und viele Kleider nähe ich auf deine Maße. Gib deinen Taillenumfang und Wünsche bei der Bestellung an oder schreib mir vorher." },
 { q: "Kann ich zur Anprobe vorbeikommen?", a: "Gern. Über den Anprobe-Planer kannst du dir einen Termin in meinem Atelier in Ramsen anfragen. Ich bestätige ihn dir persönlich." },
 { q: "Wie lange dauert eine Maßanfertigung?", a: "Meist 1–2 Wochen Nähzeit, je nach Auftragslage. Wenn ich gerade keine neuen Aufträge annehme, steht das oben auf der Seite und bei der Anprobe." },
 { q: "Stimmen die Farben auf den Fotos?", a: "Ich achte sehr darauf, aber je nach Bildschirm können Farben leicht abweichen. Frag gern nach einem Foto bei Tageslicht." },
 { q: "Wie wird verpackt?", a: "Plastikfrei und mit Liebe, auf Wunsch auch als Geschenk." },
 { q: "Kann ich zurückgeben?", a: "Passt etwas nicht, kannst du es innerhalb von 14 Tagen zurückschicken (Versandkosten trägst du). Maßanfertigungen sind Unikate, sprich mich bei Problemen einfach an." },
];

export const fmtPrice = (p, from = false) =>
 (from ? "ab " : "") + p.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

export const productById = (id) => PRODUCTS.find((p) => p.id === id);
