// Start / Übersicht
import { TODAY, formatDate, upcomingEvents, activeBanner, closedDays } from "../../../shared/store.js";
import { h, icon, btn, card, toggle, plural } from "../ui.js";
import { STATUS_MODES, SITES, bannerPreview, applyVacation, statusLabel, typeTag, eventDateText, dateParts, isRunning } from "./common.js";

function greeting() {
  const hr = new Date().getHours();
  if (hr < 11) return "Guten Morgen, Cathrin";
  if (hr < 17) return "Hallo Cathrin";
  return "Guten Abend, Cathrin";
}

const tag = (el, n) => { el.style.order = n; return el; };

export default function renderStart(ctx) {
  const c = ctx.content;
  const newReq = c.fitting.bookings.filter((b) => b.status === "angefragt");
  const upcomingConfirmed = c.fitting.bookings.filter((b) => b.status === "bestaetigt" && b.date >= TODAY).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const events = upcomingEvents(3);

  // --- Begrüßung
  const head = h("header", { class: "hello" },
    h("img", { class: "hello-avatar", src: "../img/cathrin-avatar.webp", alt: "", width: 64, height: 64 }),
    h("div", {},
      h("h1", { tabindex: "-1", class: "section-title" }, greeting()),
      h("p", { class: "lead" }, formatDate(TODAY, { weekday: "long", day: "numeric", month: "long" }) + ". Schön, dass du da bist. Hier siehst du alles Wichtige auf einen Blick.")));

  // --- Anprobe
  const fitCard = card("Anprobe-Anfragen", { icon: "scissors", cls: newReq.length ? "card-attention" : "" },
    h("a", { href: "#anprobe", class: "big-stat" },
      h("span", { class: "big-num" }, newReq.length),
      h("span", { class: "big-label" }, newReq.length === 1 ? "neue Anfrage wartet auf dich" : newReq.length ? "neue Anfragen warten auf dich" : "Keine neuen Anfragen"),
      icon("chevronRight", "ico-sm")),
    upcomingConfirmed.length ? h("p", { class: "muted small" }, `Nächste bestätigte Anprobe: ${upcomingConfirmed[0].name}, ${formatDate(upcomingConfirmed[0].date)} um ${upcomingConfirmed[0].start} Uhr`) : null,
    !c.fitting.enabled ? h("p", { class: "note note-warn" }, icon("info"), h("span", {}, "Der Anprobe-Planer ist gerade ausgeschaltet. Kundinnen können keine Termine anfragen.")) : null);

  // --- Termine
  const evCard = card("Nächste Termine", { icon: "calendar", actions: h("a", { href: "#termine", class: "text-link" }, "Alle") },
    events.length
      ? h("ul", { class: "mini-list" }, events.map((e) => {
        const p = dateParts(e);
        return h("li", {},
          h("span", { class: "date-chip" + (p.multi ? " is-range" : ""), "aria-hidden": "true" }, h("strong", {}, p.day), h("span", {}, p.month)),
          h("span", { class: "mini-text" },
            h("span", { class: "mini-tags" }, typeTag(e.type), p.multi && isRunning(e) ? h("span", { class: "tag tag-rose" }, "läuft gerade") : null),
            h("strong", {}, e.title),
            h("span", { class: "muted" }, [eventDateText(e), e.time, e.place].filter(Boolean).join(" · "))));
      }))
      : h("p", { class: "muted" }, "Gerade stehen keine Termine an."),
    h("a", { href: "#termine/neu", class: "btn btn-ghost btn-sm" }, icon("plus"), h("span", {}, "Termin eintragen")));

  // --- Hinweis
  const b = c.banner;
  const shown = activeBanner();
  let bannerState = b.active ? (shown ? "Wird gerade auf der Website angezeigt." : "Eingeschaltet, aber außerhalb des Zeitraums.") : "Ausgeschaltet – Besucherinnen sehen ihn nicht.";
  const banCard = card("Hinweis oben auf der Seite", { icon: "megaphone", actions: h("a", { href: "#hinweis", class: "text-link" }, "Bearbeiten") },
    bannerPreview(b, { compact: true }),
    toggle({ label: b.active ? "Hinweis ist an" : "Hinweis ist aus", hint: bannerState, checked: b.active, key: "start-banner-toggle",
      onChange: (v) => { ctx.save((d) => { d.banner.active = v; }); ctx.toast(v ? "Hinweis eingeschaltet" : "Hinweis ausgeschaltet", { undo: () => { ctx.save((d) => { d.banner.active = !v; }); ctx.rerender(); } }); ctx.rerender(); } }));

  // --- Atelier
  const s = c.status;
  const mode = STATUS_MODES.find((m) => m.id === s.mode) || STATUS_MODES[0];
  const vacDate = h("input", { type: "date", id: "start-vac-date", min: TODAY, "data-key": "start-vac-date", value: "" });
  const vacBanner = h("input", { type: "checkbox", id: "start-vac-banner", checked: true });
  const vacForm = h("div", { class: "vac-form", hidden: true },
    h("label", { for: "start-vac-date" }, "Im Urlaub bis einschließlich"),
    vacDate,
    h("label", { class: "check", for: "start-vac-banner" }, vacBanner, h("span", {}, "Auch als Hinweis oben auf der Seite zeigen")),
    h("div", { class: "row" },
      btn("Urlaub eintragen", { variant: "primary", icon: "check", onClick: () => {
        if (!vacDate.value) { vacDate.focus(); vacDate.setAttribute("aria-invalid", "true"); return; }
        const snap = ctx.content;
        ctx.save((d) => applyVacation(d, vacDate.value, vacBanner.checked));
        ctx.toast(`Urlaub bis ${formatDate(vacDate.value, { day: "numeric", month: "long" })} eingetragen`, { undo: () => { ctx.save((d) => { d.status = snap.status; d.banner = snap.banner; }); ctx.rerender(); } });
        ctx.rerender();
      } }),
      btn("Abbrechen", { variant: "ghost", onClick: () => { vacForm.hidden = true; } })));

  const quick = (label, ic, mutate, msg) => btn(label, { icon: ic, variant: "soft", onClick: () => {
    const snap = ctx.content;
    ctx.save(mutate);
    ctx.toast(msg, { undo: () => { ctx.save((d) => { d.status = snap.status; d.banner = snap.banner; }); ctx.rerender(); } });
    ctx.rerender();
  } });

  // Reguläre Öffnungstage, die wegen Markt/Kurs ausfallen (nur die nächsten paar)
  const closed = closedDays(35).slice(0, 3);
  const closedNote = closed.length ? h("p", { class: "note" }, icon("calendar"), h("span", {},
    "Automatisch geschlossen: ", closed.map((x) => `${formatDate(x.date)} (${x.reasons.join(", ")})`).join(", "), ".")) : null;

  const atCard = card("Atelier", { icon: "door", actions: h("a", { href: "#atelier", class: "text-link" }, "Details") },
    h("p", { class: `status-pill status-${mode.id}` }, icon(mode.icon), h("span", {}, statusLabel(s.mode))),
    s.note ? h("p", { class: "muted" }, s.note) : null,
    h("p", { class: "small strong" }, "Mit einem Tipp ändern:"),
    h("div", { class: "quick-actions" },
      quick("Heute geschlossen", "lock", (d) => { d.status.mode = "closed"; d.status.note = "Heute bleibt das Atelier geschlossen. Der Etsy-Shop ist trotzdem für dich da."; }, "Atelier steht auf „Heute geschlossen“"),
      btn("Im Urlaub bis …", { icon: "sun", onClick: () => { vacForm.hidden = false; vacDate.focus(); } }),
      quick("Wieder geöffnet", "doorOpen", (d) => {
        d.status.mode = "open"; d.status.note = "Die aktuellen Öffnungszeiten stehen immer bei Google Maps – die halte ich aktuell.";
        if (d.banner.tone === "closed" && d.banner.active) d.banner.active = false;
      }, "Atelier wieder geöffnet")),
    vacForm,
    closedNote,
    h("p", { class: "note" }, icon("google"), h("span", {}, "Bei Google stehen deine Öffnungszeiten extra. ", h("a", { href: "#atelier/google" }, "So änderst du sie dort"))));

  // --- Website ansehen
  const sitesCard = card("Website ansehen", { icon: "eye", sub: "Jede Änderung siehst du dort sofort." },
    h("div", { class: "site-list" }, SITES.map((x) => h("a", { href: x.href, target: "_blank", rel: "noopener", class: "btn btn-soft btn-block" },
      icon("eye"), h("span", {}, x.label), icon("external", "ico-sm push"), h("span", { class: "sr-only" }, " (öffnet neuen Tab)")))));

  // --- So funktioniert's
  const howCard = card("So funktioniert’s", { icon: "sparkle", cls: "card-soft" },
    h("ol", { class: "how" },
      h("li", {}, h("strong", {}, "Ändern: "), "Tipp unten (am Handy) oder links (am Computer) auf einen Bereich."),
      h("li", {}, h("strong", {}, "Fertig: "), "Es gibt keinen Speichern-Knopf. Alles wird sofort gespeichert – oben steht dann „Alles gespeichert“."),
      h("li", {}, h("strong", {}, "Vertippt? "), "Nach dem Löschen erscheint unten „Rückgängig“. Damit holst du alles zurück."),
      h("li", {}, h("strong", {}, "Nachsehen: "), "Öffne deine Website in einem zweiten Tab – sie aktualisiert sich von allein.")));

  return h("div", { class: "stack" }, head,
    // Zwei Spalten am Computer; am Handy sorgt CSS-order für: Anprobe, Termine, Hinweis, Atelier, Website, Hilfe
    h("div", { class: "dash" },
      h("div", { class: "dash-col" }, tag(fitCard, 1), tag(banCard, 3), tag(sitesCard, 5)),
      h("div", { class: "dash-col" }, tag(evCard, 2), tag(atCard, 4), tag(howCard, 6))));
}
