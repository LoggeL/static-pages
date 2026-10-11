/* Probe-HÜ: Graphen, Timer, Versionen A/B, Selbstkorrektur mit Notenschätzung, Druckmodi */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var reduced = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

  /* =====================================================================
     Graphen (QG.plot). Die Funktionen stehen hier, weil sie Code sind.
     ===================================================================== */
  var PLOTS = {
    A: {
      opts: { xmin: -3, xmax: 5, ymin: -5, ymax: 5, label: 'Parabel zu f(x) = x² − 2x − 3' },
      fns: [{ f: function (x) { return x * x - 2 * x - 3; }, color: 'blue', label: 'f', labelAt: 3.85, labelPos: 'e' }],
      sol: [
        { x: -1, y: 0, label: '−1', pos: 'nw', color: 'red' },
        { x: 3, y: 0, label: '3', pos: 'ne', color: 'red' }
      ]
    },
    B: {
      opts: { xmin: -3, xmax: 5, ymin: -1, ymax: 8, label: 'Normalparabel y = x² und Gerade y = x + 2' },
      fns: [
        { f: function (x) { return x * x; }, color: 'blue', label: 'y = x²', labelAt: 2.7, labelPos: 'e' },
        { f: function (x) { return x + 2; }, color: 'orange', label: 'y = x + 2', labelAt: 3.4, labelPos: 'se' }
      ],
      sol: [
        { x: -1, y: 1, label: 'P(−1 | 1)', pos: 'nw', color: 'red' },
        { x: 2, y: 4, label: 'Q(2 | 4)', pos: 'se', color: 'red' }
      ]
    }
  };

  QG.widget('hue-plot', function (el) {
    var cfg = PLOTS[el.getAttribute('data-plot')];
    if (!cfg) return;
    var o = {};
    Object.keys(cfg.opts).forEach(function (k) { o[k] = cfg.opts[k]; });
    o.fns = cfg.fns;
    o.points = el.hasAttribute('data-solution') ? cfg.sol : [];
    el.classList.add('qg-plot-wrap');
    QG.plot(el, o);
  });

  /* =====================================================================
     Notenschlüssel
     ===================================================================== */
  var KEY = [
    { min: 87.5, n: 1, w: 'sehr gut' },
    { min: 75, n: 2, w: 'gut' },
    { min: 62.5, n: 3, w: 'befriedigend' },
    { min: 50, n: 4, w: 'ausreichend' },
    { min: 25, n: 5, w: 'mangelhaft' },
    { min: 0, n: 6, w: 'ungenügend' }
  ];
  function grade(pct) {
    for (var i = 0; i < KEY.length; i++) if (pct >= KEY[i].min - 1e-9) return KEY[i];
    return KEY[KEY.length - 1];
  }

  function init() {
    var sec = document.getElementById('probe-hue');
    if (!sec || sec._hue) return;
    sec._hue = true;

    var VERSIONS = ['A', 'B'];
    var cur = QG.store.get('hue:v', 'A');
    if (VERSIONS.indexOf(cur) < 0) cur = 'A';

    /* ---------------------------------------------------------------
       Timer
       --------------------------------------------------------------- */
    var tCard = $('.hue-timer', sec);
    var tTime = $('.hue-time', sec);
    var tSub = $('.hue-sub', sec);
    var tRing = $('.hue-ring', sec);
    var tStart = $('.hue-start', sec);
    var tStartLabel = $('.hue-start-label', sec);
    var tReset = $('.hue-reset', sec);
    var tDone = $('.hue-done', sec);
    var tDurs = $$('.hue-dur', sec);
    var sndBox = $('.hue-snd', sec);
    var mini = $('.hue-mini', sec);
    var miniTime = $('.hue-mini-time', sec);
    var miniToggle = $('.hue-mini-toggle', sec);
    var miniJump = $('.hue-mini-jump', sec);

    var T = QG.store.get('hue:timer', null);
    if (!T || typeof T.dur !== 'number') T = { dur: 20 * 60000, running: false, endAt: 0, remain: 20 * 60000, done: false, w5: false, w1: false };
    var loop = null;
    var cardVisible = true;
    sndBox.checked = QG.store.get('hue:snd', true) !== false;

    function save() { QG.store.set('hue:timer', T); }
    function left() { return T.running ? Math.max(0, T.endAt - Date.now()) : Math.max(0, T.remain); }
    function mmss(ms) {
      var s = Math.ceil(ms / 1000);
      var m = Math.floor(s / 60);
      s = s % 60;
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function state() {
      if (T.done) return 'done';
      if (T.running) return 'running';
      if (T.remain < T.dur) return 'paused';
      return 'idle';
    }

    var actx = null;
    function unlockAudio() {
      try {
        if (!actx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (AC) actx = new AC();
        }
        if (actx && actx.state === 'suspended') actx.resume();
      } catch (e) { actx = null; }
    }
    function beep() {
      if (!actx) return;
      try {
        var t0 = actx.currentTime + 0.05;
        [0, 0.38, 0.76].forEach(function (d, i) {
          var o = actx.createOscillator();
          var g = actx.createGain();
          o.type = 'sine';
          o.frequency.value = i === 2 ? 1175 : 880;
          g.gain.setValueAtTime(0.0001, t0 + d);
          g.gain.exponentialRampToValueAtTime(0.3, t0 + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + (i === 2 ? 0.55 : 0.28));
          o.connect(g); g.connect(actx.destination);
          o.start(t0 + d); o.stop(t0 + d + 0.6);
        });
      } catch (e) { /* kein Ton möglich */ }
    }
    function alarm() {
      if (!sndBox.checked) return;
      beep();
      try {
        var act = navigator.userActivation;
        if (navigator.vibrate && (!act || act.hasBeenActive)) navigator.vibrate([300, 150, 300, 150, 600]);
      } catch (e) {}
    }

    function render() {
      var l = left();
      var st = state();
      tCard.setAttribute('data-state', st);
      tCard.classList.toggle('is-warn', st === 'running' && l <= 5 * 60000 && l > 60000);
      tCard.classList.toggle('is-last', (st === 'running' || st === 'paused') && l <= 60000);
      var txt = mmss(l);
      tTime.textContent = txt;
      miniTime.textContent = txt;
      tRing.style.setProperty('--p', (T.dur ? l / T.dur : 0).toFixed(4));
      tSub.textContent = st === 'idle' ? 'bereit' : st === 'running' ? 'läuft …' : st === 'paused' ? 'pausiert' : 'Zeit um!';
      tStartLabel.textContent = st === 'running' ? 'Pause' : st === 'paused' ? 'Weiter' : st === 'done' ? 'Neu starten' : 'Start';
      tStart.firstElementChild.textContent = st === 'running' ? '❚❚' : '▶';
      tReset.hidden = st === 'idle';
      tDone.hidden = st !== 'done';
      tDurs.forEach(function (b) {
        var on = Number(b.getAttribute('data-min')) * 60000 === T.dur;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = st === 'running' || st === 'paused';
      });
      miniToggle.textContent = st === 'running' ? 'Pause' : 'Weiter';
      mini.hidden = !((st === 'running' || st === 'paused') && !cardVisible);
      mini.classList.toggle('is-warn', st === 'running' && l <= 5 * 60000);
    }

    function tick() {
      if (!T.running) { stopLoop(); return; }
      var l = left();
      if (T.dur > 5 * 60000 && l <= 5 * 60000 && !T.w5) { T.w5 = true; save(); QG.toast('Noch 5 Minuten'); }
      if (T.dur > 60000 && l <= 60000 && !T.w1) { T.w1 = true; save(); QG.toast('Noch 1 Minute – Lösungsmengen hinschreiben!'); }
      if (l <= 0) { finish(true); return; }
      render();
    }
    function startLoop() { if (!loop) loop = setInterval(tick, 250); }
    function stopLoop() { if (loop) { clearInterval(loop); loop = null; } }

    function start() {
      unlockAudio();
      if (T.done) { T.remain = T.dur; T.done = false; T.w5 = T.w1 = false; }
      T.endAt = Date.now() + T.remain;
      T.running = true;
      save(); startLoop(); render();
    }
    function pause() {
      T.remain = left();
      T.running = false;
      save(); stopLoop(); render();
    }
    function reset() {
      T.running = false; T.done = false; T.remain = T.dur; T.w5 = T.w1 = false;
      save(); stopLoop(); render();
    }
    function finish(withAlarm) {
      T.running = false; T.done = true; T.remain = 0;
      save(); stopLoop(); render();
      if (withAlarm) {
        alarm();
        QG.toast('⏰ Zeit ist um – Stift weg!', { ms: 5000 });
      }
    }

    tStart.addEventListener('click', function () {
      var st = state();
      if (st === 'running') pause(); else start();
    });
    tReset.addEventListener('click', reset);
    miniToggle.addEventListener('click', function () { if (T.running) pause(); else start(); });
    miniJump.addEventListener('click', function () {
      tCard.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    });
    tDurs.forEach(function (b) {
      b.addEventListener('click', function () {
        if (T.running || (T.remain < T.dur && !T.done)) return;
        T.dur = Number(b.getAttribute('data-min')) * 60000;
        T.remain = T.dur; T.done = false; T.w5 = T.w1 = false;
        save(); render();
      });
    });
    sndBox.addEventListener('change', function () {
      QG.store.set('hue:snd', sndBox.checked);
      if (sndBox.checked) unlockAudio();
    });
    $('.hue-snd-test', sec).addEventListener('click', function () {
      unlockAudio();
      beep();
      try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) {}
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && T.running) tick(); });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { cardVisible = en.isIntersecting; });
        render();
      }, { rootMargin: '-70px 0px 0px 0px', threshold: 0 }).observe(tCard);
    }

    // Zustand nach dem Neuladen
    if (T.running) {
      if (T.endAt <= Date.now()) finish(false);
      else startLoop();
    }
    render();

    /* ---------------------------------------------------------------
       Versionen A / B
       --------------------------------------------------------------- */
    var tabs = $$('.hue-tab', sec);
    function setVersion(v, focus) {
      cur = v;
      QG.store.set('hue:v', v);
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-v') === v;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        if (on && focus) t.focus();
      });
      $$('.hue-panel', sec).forEach(function (p) { p.hidden = p.getAttribute('data-v') !== v; });
      renderScore();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { setVersion(t.getAttribute('data-v')); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          setVersion(n.getAttribute('data-v'), true);
        }
      });
    });

    /* ---------------------------------------------------------------
       Selbstkorrektur & Auswertung
       --------------------------------------------------------------- */
    var res = $('.hue-result', sec);
    var S = {};
    VERSIONS.forEach(function (v) {
      var st = QG.store.get('hue:' + v, null) || {};
      S[v] = { c: Array.isArray(st.c) ? st.c : [], open: !!st.open, ev: !!st.ev };
    });
    function corrPanel(v) { return $('.hue-corr[data-v="' + v + '"]', sec); }
    function saveS(v) { QG.store.set('hue:' + v, S[v]); }

    function chapterLinks(ids) {
      return ids.split(/\s+/).filter(Boolean).map(function (id) {
        var c = (QG.chapters || []).filter(function (x) { return x.id === id; })[0];
        if (!c) return '';
        return '<a class="hue-go" href="#' + QG.esc(id) + '" data-color="' + QG.esc(c.color) + '"><span aria-hidden="true">' + QG.esc(c.icon) + '</span> ' + QG.esc(c.short) + ' →</a>';
      }).join('');
    }

    function compute(v) {
      var panel = corrPanel(v);
      var total = 0, max = 0, items = [];
      $$('.hue-c', panel).forEach(function (card) {
        var boxes = $$('input[type="checkbox"][data-p]', card);
        var p = 0, m = 0;
        boxes.forEach(function (b) { var w = Number(b.getAttribute('data-p')) || 0; m += w; if (b.checked) p += w; });
        total += p; max += m;
        items.push({ card: card, p: p, m: m });
      });
      return { total: total, max: max, items: items };
    }

    function renderScore() {
      VERSIONS.forEach(function (v) {
        var panel = corrPanel(v);
        panel.classList.toggle('is-locked', !S[v].open);
        var r = compute(v);
        r.items.forEach(function (it) {
          var sc = $('.hue-score', it.card);
          sc.querySelector('b').textContent = QG.fmt(it.p);
          it.card.classList.toggle('is-full', it.p === it.m && it.m > 0);
          $$('.hue-crit label', it.card).forEach(function (lb) {
            var cb = lb.querySelector('input');
            lb.classList.toggle('is-on', cb.checked);
          });
        });
        var tab = $('.hue-tab[data-v="' + v + '"] .hue-tab-state', sec);
        var pct = r.max ? 100 * r.total / r.max : 0;
        if (S[v].ev) tab.textContent = QG.fmt(r.total) + ' / ' + r.max + ' P. · Note ≈ ' + grade(pct).n;
        else tab.textContent = S[v].open ? 'in Korrektur' : 'noch offen';
        tab.parentNode.parentNode.classList.toggle('is-evaluated', S[v].ev);
      });

      // Ergebnis-Karte für die aktive Version
      var r = compute(cur);
      var s = S[cur];
      var pct = r.max ? 100 * r.total / r.max : 0;
      var g = grade(pct);
      res.hidden = !s.open;
      $('.hue-result-v', res).textContent = 'Probe-HÜ ' + cur;
      $('.hue-sum', res).textContent = QG.fmt(r.total);
      $('.hue-total-num > span', res).textContent = ' / ' + r.max + ' Punkte';
      $('.hue-total-pct', res).textContent = QG.fmt(Math.round(pct)) + ' %';
      $('.hue-bar > span', res).style.width = pct.toFixed(1) + '%';
      res.setAttribute('data-grade', s.ev ? String(g.n) : '');
      $('.hue-grade', res).textContent = s.ev ? String(g.n) : '–';
      $('.hue-grade-word', res).textContent = s.ev ? g.n + ' (' + g.w + ')' : 'tippe auf „Auswertung anzeigen“, wenn du alles abgehakt hast';
      $('.hue-eval-row', res).hidden = s.ev;
      var recs = $('.hue-recs', res);
      recs.hidden = !s.ev;
      if (s.ev) {
        var other = cur === 'A' ? 'B' : 'A';
        var msg;
        if (g.n <= 2) msg = 'Stark! Du bist gut vorbereitet. Wiederhole nur die Aufgaben unten, bei denen noch Punkte fehlen – und lies am Abend vorher den Spickzettel.';
        else if (g.n <= 4) msg = 'Solide Basis! Mit den Kapiteln unten holst du dir die fehlenden Punkte. Danach: Probe-HÜ ' + other + '.';
        else msg = 'Kein Grund zur Panik – jetzt weißt du genau, wo es hakt. Arbeite die Liste unten von oben nach unten ab und schreib danach Probe-HÜ ' + other + '.';
        $('.hue-recs-msg', recs).textContent = msg;
        var list = r.items.map(function (it) {
          var q = it.m ? it.p / it.m : 1;
          return { it: it, q: q };
        }).sort(function (a, b) { return a.q - b.q; });
        var html = list.map(function (x) {
          var it = x.it;
          var num = $('.hue-num', it.card).textContent;
          var title = $('h3', it.card).textContent;
          var cls, label;
          if (x.q >= 1) { cls = 'ok'; label = 'sitzt'; }
          else if (x.q >= 0.5) { cls = 'mid'; label = 'kurz wiederholen'; }
          else { cls = 'bad'; label = 'nochmal üben'; }
          var links = x.q >= 1 ? '' : chapterLinks(it.card.getAttribute('data-go') || '');
          return '<li class="hue-rec ' + cls + '">' +
            '<span class="hue-rec-ico" aria-hidden="true">' + (cls === 'ok' ? '✓' : cls === 'mid' ? '↻' : '!') + '</span>' +
            '<div class="hue-rec-body"><p><b>Aufgabe ' + QG.esc(num) + ' · ' + QG.esc(title) + '</b> <span class="hue-rec-pts">' + QG.fmt(it.p) + ' / ' + it.m + ' P.</span></p>' +
            '<p class="hue-rec-state">' + label + '</p>' +
            (links ? '<p class="hue-rec-links">' + links + '</p>' : '') + '</div></li>';
        }).join('');
        $('.hue-rec-list', recs).innerHTML = html;
      }
    }

    VERSIONS.forEach(function (v) {
      var panel = corrPanel(v);
      var boxes = $$('input[type="checkbox"][data-p]', panel);
      boxes.forEach(function (b, i) {
        b.checked = !!S[v].c[i];
        b.addEventListener('change', function () {
          S[v].c = boxes.map(function (x) { return x.checked ? 1 : 0; });
          saveS(v);
          renderScore();
        });
      });
      $('.hue-unlock', panel).addEventListener('click', function () {
        S[v].open = true; saveS(v);
        if (T.running) { pause(); QG.toast('Timer angehalten'); }
        renderScore();
        var first = $('.hue-c', panel);
        if (first) setTimeout(function () { first.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); }, 30);
      });
    });

    $('.hue-eval', res).addEventListener('click', function () {
      S[cur].ev = true; saveS(cur);
      renderScore();
      var r = compute(cur);
      if (r.max && 100 * r.total / r.max >= 75) QG.celebrate($('.hue-grade', res));
      $('.hue-grade-row', res).scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    });
    $('.hue-relock', res).addEventListener('click', function () {
      S[cur].open = false; saveS(cur);
      $$('details', corrPanel(cur)).forEach(function (d) { d.open = false; });
      renderScore();
      $('#hue-korrektur').scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    });
    var resetBtn = $('.hue-reset-score', res);
    var resetArm = null;
    resetBtn.addEventListener('click', function () {
      if (!resetArm) {
        resetBtn.textContent = 'Wirklich zurücksetzen?';
        resetBtn.classList.add('is-armed');
        resetArm = setTimeout(function () {
          resetArm = null;
          resetBtn.textContent = '↺ Bewertung zurücksetzen';
          resetBtn.classList.remove('is-armed');
        }, 3500);
        return;
      }
      clearTimeout(resetArm); resetArm = null;
      resetBtn.textContent = '↺ Bewertung zurücksetzen';
      resetBtn.classList.remove('is-armed');
      S[cur] = { c: [], open: true, ev: false };
      saveS(cur);
      $$('input[type="checkbox"][data-p]', corrPanel(cur)).forEach(function (b) { b.checked = false; });
      renderScore();
      QG.toast('Bewertung zurückgesetzt');
    });

    // Sprung zur Selbstkorrektur
    $$('.hue-to-corr', sec).forEach(function (b) {
      b.addEventListener('click', function () {
        var target = $('#hue-korrektur');
        if (target) target.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      });
    });

    /* ---------------------------------------------------------------
       Drucken: Aufgabenblatt (ohne Lösungen) oder Lösungen
       --------------------------------------------------------------- */
    var printOpened = [];
    function cleanupPrint() {
      document.body.classList.remove('hue-print-sol', 'hue-print-sheet');
      printOpened.forEach(function (d) { d.open = false; });
      printOpened = [];
    }
    function doPrint(mode) {
      cleanupPrint();
      document.body.classList.add(mode === 'sol' ? 'hue-print-sol' : 'hue-print-sheet');
      if (mode === 'sol') {
        $$('details.hue-eh', corrPanel(cur)).forEach(function (d) {
          if (!d.open) { d.open = true; printOpened.push(d); }
        });
      }
      setTimeout(function () { window.print(); }, 80);
    }
    window.addEventListener('afterprint', function () { setTimeout(cleanupPrint, 0); });
    $('.hue-print-sheet', sec).addEventListener('click', function () { doPrint('sheet'); });
    $('.hue-print-sol', sec).addEventListener('click', function () { doPrint('sol'); });

    setVersion(cur);
  }

  QG.ready(init);
})();
