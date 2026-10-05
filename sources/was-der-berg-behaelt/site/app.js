(function () {
  "use strict";

  var store = {
    get: function (k) { try { return localStorage.getItem("wdbb-" + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem("wdbb-" + k, v); } catch (e) {} },
  };

  var $ = function (id) { return document.getElementById(id); };
  var views = { cover: $("view-cover"), toc: $("view-toc"), chapter: $("view-chapter") };
  var bar = $("bar");
  var book = null;
  var byId = {};
  var current = null;
  var saveTimer = null;

  function minutes(words) { return Math.max(1, Math.round(words / 230)); }
  function readSet() {
    try { return JSON.parse(store.get("read") || "[]"); } catch (e) { return []; }
  }
  function markRead(id) {
    var r = readSet();
    if (r.indexOf(id) < 0) { r.push(id); store.set("read", JSON.stringify(r)); }
  }
  function chapterLabel(c) {
    if (c.kind === "kapitel") return c.label.replace(/^Kapitel\s+/, "Kapitel ");
    return c.label;
  }

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    bar.hidden = name === "cover";
    $("settings").hidden = true;
    $("btn-settings").setAttribute("aria-expanded", "false");
    hidePop();
  }

  function renderCover() {
    show("cover");
    document.title = "Was der Berg behält";
    var last = store.get("last");
    var cont = $("btn-continue");
    if (last && byId[last]) {
      cont.hidden = false;
      cont.href = "#" + last;
      cont.textContent = "Weiterlesen · " + (byId[last].kind === "kapitel" ? chapterLabel(byId[last]) : byId[last].title);
      $("btn-start").classList.remove("btn--primary");
      cont.classList.add("btn--primary");
    }
    var novel = book.chapters.filter(function (c) { return c.kind !== "anhang"; });
    $("cover-meta").textContent = novel.length - 2 + " Kapitel mit Prolog und Epilog · rund " +
      Math.round(book.totalWords / 1000) + ".000 Wörter · etwa " + Math.round(book.totalWords / 230 / 60) + " Stunden Lesezeit";
    setProgress(0);
  }

  function renderToc() {
    show("toc");
    document.title = "Inhalt · Was der Berg behält";
    $("bar-title").textContent = "Inhalt";
    var nav = $("toc-list");
    nav.innerHTML = "";
    var read = readSet();
    var last = store.get("last");
    var lastPart = -1;
    book.chapters.forEach(function (c) {
      if (c.part !== lastPart && (c.partStart || c.kind === "anhang")) {
        if (c.kind === "anhang" && lastPart === 4) { /* schon gesetzt */ }
        else {
          var p = book.parts.filter(function (x) { return x.n === c.part; })[0];
          var head = document.createElement("div");
          head.className = "toc__part";
          if (p) {
            head.innerHTML = '<img src="' + p.image + '" alt="" loading="lazy"><div><p>Teil ' + p.roman + "</p><h3>" + p.title + "</h3></div>";
          } else {
            head.innerHTML = '<span></span><div><p>Zum Roman</p><h3>Anhang</h3></div>';
          }
          nav.appendChild(head);
        }
        lastPart = c.part;
      }
      var a = document.createElement("a");
      a.className = "toc__item" + (read.indexOf(c.id) >= 0 ? " is-read" : "") + (c.id === last ? " is-current" : "");
      a.href = "#" + c.id;
      var lab = c.kind === "kapitel" ? c.label.replace("Kapitel ", "") : c.kind === "anhang" ? "" : c.label;
      a.innerHTML = "<small>" + lab + "</small><span>" + c.title + "</span><em>" + minutes(c.words) + " min</em>";
      nav.appendChild(a);
    });
    window.scrollTo(0, 0);
    setProgress(0);
  }

  function renderChapter(id) {
    var c = byId[id];
    if (!c) { location.hash = ""; return; }
    show("chapter");
    current = c;
    var idx = book.chapters.indexOf(c);
    views.chapter.className = "chapter" + (c.kind === "anhang" ? " chapter--anhang" : "");
    var p = c.partStart && c.kind === "kapitel" ? book.parts.filter(function (x) { return x.n === c.part; })[0] : null;
    $("part-opener").hidden = !p;
    if (p) {
      $("part-img").src = p.image;
      $("part-num").textContent = "Teil " + p.roman;
      $("part-title").textContent = p.title;
    }
    $("ch-label").textContent = c.kind === "anhang" ? "Anhang" : chapterLabel(c);
    $("ch-title").textContent = c.title;
    $("ch-head").innerHTML = c.head || "";
    $("ch-head").hidden = !c.head;
    $("ch-body").innerHTML = c.html;
    $("bar-title").textContent = (c.kind === "kapitel" ? c.label.replace("Kapitel ", "") + " · " : "") + c.title;
    document.title = c.title + " · Was der Berg behält";

    var prev = book.chapters[idx - 1], next = book.chapters[idx + 1];
    setPager($("prev"), prev);
    setPager($("next"), next);

    if (c.kind !== "anhang") store.set("last", c.id);
    var pos = parseFloat(store.get("pos-" + c.id) || "0");
    requestAnimationFrame(function () {
      var max = document.documentElement.scrollHeight - innerHeight;
      window.scrollTo(0, pos > 0.02 && pos < 0.98 ? pos * max : 0);
      onScroll();
    });
  }

  function setPager(el, c) {
    if (!c) { el.classList.add("is-empty"); el.removeAttribute("href"); return; }
    el.classList.remove("is-empty");
    el.href = "#" + c.id;
    el.querySelector("span").textContent = c.title;
  }

  function setProgress(f) { $("progress").style.width = (f * 100).toFixed(2) + "%"; }

  var lastY = 0;
  function onScroll() {
    if (views.chapter.hidden || !current) return;
    var max = document.documentElement.scrollHeight - innerHeight;
    var f = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 1;
    setProgress(f);
    var y = scrollY;
    bar.classList.toggle("is-hidden", y > lastY + 4 && y > 160 && $("settings").hidden);
    if (y < lastY - 4) bar.classList.remove("is-hidden");
    lastY = y;
    clearTimeout(saveTimer);
    var id = current.id;
    saveTimer = setTimeout(function () {
      store.set("pos-" + id, f.toFixed(4));
      if (f > 0.92) markRead(id);
    }, 250);
  }

  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) renderCover();
    else if (h === "inhalt") renderToc();
    else renderChapter(h);
  }

  // Glossar-Popover
  var pop = $("gl-pop");
  function showPop(el) {
    pop.textContent = el.getAttribute("data-gl");
    pop.hidden = false;
    var r = el.getBoundingClientRect();
    var w = pop.offsetWidth;
    var left = Math.min(Math.max(12, r.left + scrollX + r.width / 2 - w / 2), scrollX + innerWidth - w - 12);
    pop.style.left = left + "px";
    pop.style.top = r.bottom + scrollY + 8 + "px";
  }
  function hidePop() { pop.hidden = true; }
  document.addEventListener("click", function (e) {
    var g = e.target.closest && e.target.closest("em.gl");
    if (g) { showPop(g); e.stopPropagation(); return; }
    if (!e.target.closest || !e.target.closest(".gl-pop")) hidePop();
    if (!e.target.closest(".settings") && !e.target.closest("#btn-settings")) {
      $("settings").hidden = true;
      $("btn-settings").setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("focusin", function (e) {
    if (e.target.matches && e.target.matches("em.gl")) showPop(e.target);
  });

  // Einstellungen
  $("btn-toc").addEventListener("click", function () { location.hash = "inhalt"; });
  $("btn-settings").addEventListener("click", function () {
    var s = $("settings");
    s.hidden = !s.hidden;
    this.setAttribute("aria-expanded", String(!s.hidden));
  });
  function fontSize(delta) {
    var cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 19;
    var n = Math.min(26, Math.max(15, cur + delta));
    document.documentElement.style.setProperty("--fs", n + "px");
    store.set("size", String(n));
  }
  $("fs-down").addEventListener("click", function () { fontSize(-1); });
  $("fs-up").addEventListener("click", function () { fontSize(1); });
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    store.set("theme", t);
    document.querySelectorAll("[data-theme-set]").forEach(function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute("data-theme-set") === t));
    });
  }
  document.querySelectorAll("[data-theme-set]").forEach(function (b) {
    b.addEventListener("click", function () { applyTheme(b.getAttribute("data-theme-set")); });
  });
  applyTheme(store.get("theme") || "auto");

  document.addEventListener("keydown", function (e) {
    if (views.chapter.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea")) return;
    if (e.key === "ArrowRight" && !$("next").classList.contains("is-empty")) location.hash = $("next").getAttribute("href");
    if (e.key === "ArrowLeft" && !$("prev").classList.contains("is-empty")) location.hash = $("prev").getAttribute("href");
    if (e.key === "Escape") hidePop();
  });

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("hashchange", route);

  fetch("book.json")
    .then(function (r) { return r.json(); })
    .then(function (b) {
      book = b;
      b.chapters.forEach(function (c) { byId[c.id] = c; });
      route();
    })
    .catch(function () {
      $("cover-meta").textContent = "Der Text konnte nicht geladen werden. Bitte die Seite neu laden.";
    });
})();
