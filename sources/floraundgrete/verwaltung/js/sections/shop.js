// Shop-Auswahl: welche Stücke vorne auf der Website gezeigt werden
import { PRODUCTS, CATEGORIES, productById, fmtPrice, SHOP } from "../../../shared/data.js";
import { h, icon, btn, iconBtn, card, sectionHeader, emptyState, linkBtn } from "../ui.js";

export default function renderShop(ctx) {
  const featured = ctx.content.featured.filter((id) => productById(id));

  const setFeatured = (fn) => { ctx.save((d) => { d.featured = fn(d.featured.filter((id) => productById(id))); }); ctx.rerender(); };
  const move = (i, dir) => {
    const id = featured[i];
    setFeatured((f) => { const [x] = f.splice(i, 1); f.splice(i + dir, 0, x); return f; });
    const t = document.querySelector(`[data-key="fe-${dir < 0 ? "up" : "down"}-${id}"]`);
    if (t && !t.disabled) t.focus(); else document.querySelector(`[data-key="fe-${dir < 0 ? "down" : "up"}-${id}"]`)?.focus();
  };
  const removeAt = (id) => {
    const idx = featured.indexOf(id);
    setFeatured((f) => f.filter((x) => x !== id));
    ctx.toast(`${productById(id).name} wird nicht mehr vorne gezeigt`, { undo: () => setFeatured((f) => { f.splice(idx, 0, id); return f; }) });
  };
  const toggleProduct = (id, on) => {
    if (on) { setFeatured((f) => [...f.filter((x) => x !== id), id]); ctx.toast(`${productById(id).name} hinzugefügt (Platz ${featured.length + 1})`); }
    else removeAt(id);
  };

  const tags = (p) => [p.isNew && "Neu", p.unique && "Unikat", p.madeToMeasure && "auf Maß", p.freeShipping && "versandkostenfrei"].filter(Boolean);

  // Reihenfolge
  const orderList = featured.length
    ? h("ol", { class: "fe-list" }, featured.map((id, i) => {
      const p = productById(id);
      return h("li", { class: "fe" },
        h("span", { class: "fe-pos", "aria-hidden": "true" }, i + 1),
        h("img", { src: `../img/${p.hero}`, alt: "", width: 64, height: 80, loading: "lazy" }),
        h("span", { class: "fe-name" }, h("strong", {}, p.name), h("span", { class: "muted small" }, fmtPrice(p.price, p.priceFrom))),
        h("span", { class: "fe-btns" },
          iconBtn("up", `${p.name} nach vorne`, () => move(i, -1), { disabled: i === 0, attrs: { "data-key": `fe-up-${id}` } }),
          iconBtn("down", `${p.name} nach hinten`, () => move(i, 1), { disabled: i === featured.length - 1, attrs: { "data-key": `fe-down-${id}` } }),
          iconBtn("x", `${p.name} nicht mehr vorne zeigen`, () => removeAt(id), { cls: "icon-btn-danger" })));
    }))
    : emptyState("bag", "Noch nichts ausgewählt", "Hak unten deine Lieblingsstücke an – sie erscheinen dann groß auf der Startseite.");

  const orderCard = card(`Vorne auf der Website (${featured.length})`, { icon: "star", sub: "In dieser Reihenfolge erscheinen die Stücke. Schön wirken 4 bis 8." }, orderList);

  // Alle Produkte, nach Kategorie
  const productCard = (p) => {
    const on = featured.includes(p.id);
    const cid = "pr-" + p.id;
    return h("li", { class: "pr" + (on ? " is-on" : "") },
      h("div", { class: "pr-img" }, h("img", { src: `../img/${p.hero}`, alt: p.name, loading: "lazy", width: 300, height: 375 }),
        tags(p).length ? h("span", { class: "pr-tags" }, tags(p).map((t) => h("span", { class: "tag tag-cream" }, t))) : null),
      h("div", { class: "pr-body" },
        tags(p).length ? h("span", { class: "pr-tags-body", "aria-hidden": "true" }, tags(p).map((t) => h("span", { class: "tag tag-cream" }, t))) : null,
        h("h3", { class: "pr-name" }, p.name),
        h("p", { class: "pr-meta" }, h("strong", {}, fmtPrice(p.price, p.priceFrom)), " · ", p.subtitle),
        h("label", { class: "check check-big", for: cid },
          h("input", { type: "checkbox", id: cid, checked: on, "data-key": cid, onChange: (e) => toggleProduct(p.id, e.target.checked) }),
          h("span", {}, on ? `Wird gezeigt (Platz ${featured.indexOf(p.id) + 1})` : "Vorne zeigen")),
        h("a", { class: "text-link small", href: p.url, target: "_blank", rel: "noopener" }, icon("external", "ico-xs"), "Auf Etsy ansehen", h("span", { class: "sr-only" }, ` (${p.name}, neuer Tab)`))));
  };

  const catalog = CATEGORIES.map((cat) => {
    const items = PRODUCTS.filter((p) => p.category === cat.id);
    if (!items.length) return null;
    return h("section", { class: "pr-cat", "aria-labelledby": "cat-" + cat.id },
      h("h3", { class: "list-title", id: "cat-" + cat.id }, cat.label, " ", h("span", { class: "count" }, items.length)),
      h("ul", { class: "pr-grid" }, items.map(productCard)));
  });

  return h("div", { class: "stack" },
    sectionHeader("Shop-Auswahl", "Such dir aus, welche Stücke groß auf deiner Website gezeigt werden."),
    h("p", { class: "note note-info" }, icon("info"), h("span", {},
      h("strong", {}, "Preise, Fotos und Texte kommen aus deinem Etsy-Shop. "),
      "In der fertigen Website werden sie automatisch von Etsy übernommen – du pflegst sie also nur dort. In diesem Prototyp sind sie fest eingetragen.")),
    h("div", { class: "split split-shop" },
      h("div", { class: "split-side split-first" }, h("div", { class: "sticky" }, orderCard)),
      h("div", { class: "split-main" },
        card("Alle Stücke", { icon: "bag", sub: `${PRODUCTS.length} Artikel aus deinem Etsy-Shop`, actions: linkBtn("Etsy-Shop", SHOP.etsy, { icon: "external", small: true, variant: "ghost", newTab: true }) },
          catalog))));
}
