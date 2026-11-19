// Über mich: kurzer Steckbrief-Text
import { ABOUT, SHOP } from "../../../shared/data.js";
import { h, icon, btn, card, field, sectionHeader } from "../ui.js";

export default function renderUeber(ctx) {
  const own = ctx.content.aboutIntro || "";
  const previewText = h("p", { class: "about-text" });
  const stateLine = h("p", { class: "small muted", "aria-live": "polite" });
  const refresh = (v) => {
    previewText.textContent = v.trim() || ABOUT.intro;
    stateLine.textContent = v.trim() ? "Dein eigener Text wird angezeigt." : "Gerade wird der Vorschlagstext angezeigt (grau im Feld).";
  };

  const area = field({ label: "Dein Text über dich", type: "textarea", rows: 7, value: own, key: "about-intro", counter: 400, placeholder: ABOUT.intro,
    hint: "Zwei, drei Sätze reichen. Wer bist du, was nähst du, was liebst du daran? Leer lassen = der graue Vorschlag wird gezeigt.",
    onInput: (v) => { ctx.save((d) => { d.aboutIntro = v; }); refresh(v); } });

  const actions = h("div", { class: "row" },
    btn("Vorschlag übernehmen und anpassen", { icon: "edit", onClick: () => {
      if (!area.control.value.trim()) { area.control.value = ABOUT.intro; area.control.dispatchEvent(new Event("input")); }
      area.control.focus(); area.control.setSelectionRange(area.control.value.length, area.control.value.length);
    } }),
    btn("Auf Vorschlag zurücksetzen", { icon: "refresh", variant: "ghost", onClick: () => {
      const before = area.control.value;
      if (!before) return;
      area.control.value = ""; area.control.dispatchEvent(new Event("input"));
      ctx.toast("Text zurückgesetzt", { undo: () => { ctx.save((d) => { d.aboutIntro = before; }); ctx.rerender(); } });
    } }));

  refresh(own);

  const preview = card("So steht es auf deiner Website", { icon: "eye" },
    h("div", { class: "about-pv" },
      h("img", { src: `../img/${SHOP.portraitSmall}`, alt: "", width: 88, height: 88 }),
      h("div", {}, h("p", { class: "about-head" }, ABOUT.headline), h("p", { class: "about-role" }, SHOP.ownerRole), previewText)),
    stateLine);

  const facts = card("Steckbrief", { icon: "heart", sub: "Diese Punkte stehen neben deinem Text. Im Prototyp sind sie fest – sag einfach Bescheid, wenn du etwas ändern möchtest." },
    h("dl", { class: "facts" }, ABOUT.facts.map((f) => [h("dt", {}, f.label), h("dd", {}, f.value)])));

  return h("div", { class: "stack" },
    sectionHeader("Über mich", "Ein paar Sätze von dir – damit man spürt, wer hinter Flora & Grete steckt."),
    h("div", { class: "split" },
      h("div", { class: "split-main stack" }, card("", {}, area, actions), facts),
      h("aside", { class: "split-side" }, h("div", { class: "sticky" }, preview))));
}
