// Start / Übersicht
import { TODAY, formatDate, upcomingEvents, activeBanner } from "../../../shared/store.js";
import { h, icon, btn, card, toggle, plural } from "../ui.js";
import { SITES, bannerPreview, applyVacation, endVacation, VACATION_MAX_DAYS, addDays, typeTag, eventDateText, dateParts, isRunning } from "./common.js";

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

  // --- Urlaub (es gibt keine Öffnungszeiten mehr: Besuche nur nach Termin)
  const maxDate = addDays(TODAY, VACATION_MAX_DAYS);
  const vac = c.vacation && c.vacation.until >= TODAY ? c.vacation : null;
  const vacDate = h("input", { type: "date", id: "start-vac-date", min: TODAY, max: maxDate, "data-key": "start-vac-date", value: "", "aria-describedby": "start-vac-err" });
  const vacErr = h("p", { class: "field-error", id: "start-vac-err", hidden: true });
  vacDate.addEventListener("input", () => { vacErr.hidden = true; vacDate.removeAttribute("aria-invalid"); });
  const vacCourses = h("input", { type: "checkbox", id: "start-vac-courses", checked: true });
  const vacBanner = h("input", { type: "checkbox", id: "start-vac-banner", checked: true });
  const fail = (msg) => { vacErr.textContent = msg; vacErr.hidden = false; vacDate.setAttribute("aria-invalid", "true"); vacDate.focus(); };
  const atCard = card("Urlaub oder Pause", { icon: "sun", sub: "Keine Anproben bis zu einem Datum – mit einem Tipp." },
    vac
      ? h("div", { class: "vac-form" },
        h("p", { class: "status-pill status-vacation" }, icon("sun"), h("span", {}, `Pause bis einschließlich ${formatDate(vac.until, { day: "numeric", month: "long" })}`)),
        h("p", { class: "muted small" }, "In dieser Zeit sind Anproben gesperrt" + (vac.breaks && vac.breaks.length ? " und die festen Kurse fallen aus." : ".")),
        btn("Pause vorzeitig beenden", { icon: "doorOpen", attrs: { "data-key": "start-vac-end" }, onClick: () => {
          const snap = ctx.content;
          ctx.save((d) => endVacation(d));
          ctx.toast("Pause beendet – Anproben und Kurse sind wieder frei", { undo: () => { ctx.save((d) => { d.fitting.blocked = snap.fitting.blocked; d.courseBreaks = snap.courseBreaks; d.banner = snap.banner; d.vacation = snap.vacation; }); ctx.rerender(); } });
          ctx.rerender();
        } }))
      : h("div", { class: "vac-form" },
        h("label", { for: "start-vac-date" }, "Pause bis einschließlich"),
        vacDate, vacErr,
        h("label", { class: "check", for: "start-vac-courses" }, vacCourses, h("span", {}, "Feste Kurse fallen in der Zeit auch aus")),
        h("label", { class: "check", for: "start-vac-banner" }, vacBanner, h("span", {}, "Als Hinweis oben auf der Seite zeigen")),
        h("div", { class: "row" },
          btn("Pause eintragen", { variant: "primary", icon: "check", attrs: { "data-key": "start-vac-save" }, onClick: () => {
            const v = vacDate.value;
            if (!v) return fail("Bitte wähle ein Datum.");
            if (v < TODAY) return fail("Dieser Tag liegt schon in der Vergangenheit.");
            if (v > maxDate) return fail("Eine Pause geht höchstens ein Jahr. Bitte prüf das Jahr.");
            const snap = ctx.content;
            // Anproben, die in die Pause fallen, nicht stillschweigend übergehen
            const hit = snap.fitting.bookings.filter((b) => b.status !== "abgelehnt" && b.date >= TODAY && b.date <= v);
            ctx.save((d) => applyVacation(d, v, { banner: vacBanner.checked, courses: vacCourses.checked }));
            const when = formatDate(v, { day: "numeric", month: "long" });
            const msg = hit.length
              ? `Pause bis ${when} eingetragen. Achtung: ${hit.length === 1 ? "1 Anprobe liegt" : `${hit.length} Anproben liegen`} in dieser Zeit (${hit.map((b) => `${b.name}, ${formatDate(b.date, { day: "numeric", month: "short" })}`).join("; ")}) – bitte absagen oder verschieben.`
              : `Pause bis ${when} eingetragen`;
            ctx.toast(msg, { undo: () => { ctx.save((d) => { d.fitting.blocked = snap.fitting.blocked; d.courseBreaks = snap.courseBreaks; d.banner = snap.banner; d.vacation = snap.vacation; }); ctx.rerender(); } });
            ctx.rerender();
          } }))));

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
    // Zwei Spalten am Computer; am Handy sorgt CSS-order für: Anprobe, Termine, Hinweis, Urlaub, Website, Hilfe
    h("div", { class: "dash" },
      h("div", { class: "dash-col" }, tag(fitCard, 1), tag(banCard, 3), tag(sitesCard, 5)),
      h("div", { class: "dash-col" }, tag(evCard, 2), tag(atCard, 4), tag(howCard, 6))));
}
