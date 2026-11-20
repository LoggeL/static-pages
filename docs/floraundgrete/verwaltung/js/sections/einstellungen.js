// Einstellungen: Demo zurücksetzen, abmelden, Hinweise zum Prototyp
import { reset } from "../../../shared/store.js";
import { h, icon, btn, card, sectionHeader } from "../ui.js";
import { SITES } from "./common.js";

export default function renderEinstellungen(ctx) {
  const resetCard = card("Demo zurücksetzen", { icon: "refresh", sub: "Stellt alle Beispiel-Inhalte wieder her: Hinweis, Termine, Links, Anfragen, Auswahl und Texte." },
    btn("Alles auf Anfang", { icon: "refresh", variant: "danger", attrs: { "data-key": "reset" }, onClick: () => {
      const snapshot = ctx.content;
      ctx.run(() => reset());
      ctx.toast("Demo zurückgesetzt", { undo: () => { ctx.save(ctx.replaceAll(snapshot)); ctx.rerender(); } });
      ctx.rerender();
    } }),
    h("p", { class: "small muted" }, "Keine Sorge: Direkt danach kannst du es unten mit „Rückgängig“ wieder holen."));

  const infoCard = card("Über diesen Prototyp", { icon: "info", cls: "card-soft" },
    h("ul", { class: "how" },
      h("li", {}, h("strong", {}, "Prototyp: "), "Daten bleiben nur in diesem Browser gespeichert. Auf einem anderen Gerät siehst du wieder die Beispiel-Inhalte."),
      h("li", {}, "Alle fünf Entwürfe lesen dieselben Daten – öffne einen in einem zweiten Tab und schau zu, wie sich Änderungen sofort zeigen."),
      h("li", {}, "In der fertigen Version meldest du dich mit Passwort an, und alles wird sicher online gespeichert.")),
    h("div", { class: "site-list" }, SITES.map((s) => h("a", { href: s.href, target: "_blank", rel: "noopener", class: "btn btn-soft btn-block" },
      h("span", { class: "site-n", "aria-hidden": "true" }, s.n), h("span", {}, s.label), icon("external", "ico-sm push"), h("span", { class: "sr-only" }, " (öffnet neuen Tab)")))));

  const outCard = card("Abmelden", { icon: "logout" },
    h("p", { class: "muted" }, "Schließt die Verwaltung in diesem Tab. Deine Änderungen bleiben gespeichert."),
    btn("Abmelden", { icon: "logout", onClick: () => ctx.logout() }));

  return h("div", { class: "stack" },
    sectionHeader("Einstellungen", null),
    h("div", { class: "grid-2" }, resetCard, outCard, infoCard));
}
