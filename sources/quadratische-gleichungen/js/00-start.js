/* Kapitel 00 · Start: Kapitel-Übersicht, Lernplan, Selbsttest-Auswertung */
(function () {
  'use strict';
  var QG = window.QG;
  if (!QG) return;
  var esc = QG.esc;

  /* Zuletzt besuchtes Kapitel merken (für „Weiter bei …“) */
  QG.on('chapter', function (id) {
    if (id && id !== 'start') QG.store.set('start:last', id);
  });

  /* ---------- Kapitel-Übersicht mit Fortschritt ---------- */
  QG.widget('start-overview', function (el) {
    var R = 27, CIRC = 2 * Math.PI * R;
    var tiles = {};
    var built = 0;

    function build() {
      var chs = QG.chapters.filter(function (c) { return c.id !== 'start'; });
      built = chs.length;
      el.innerHTML =
        '<div class="st-ov-head">' +
          '<div class="st-ring-wrap" aria-hidden="true">' +
            '<svg viewBox="0 0 64 64"><circle class="st-ring-bg" cx="32" cy="32" r="' + R + '"/>' +
            '<circle class="st-ring-fg" cx="32" cy="32" r="' + R + '" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="' + CIRC.toFixed(2) + '"/></svg>' +
            '<span class="st-ring-pct">0 %</span>' +
          '</div>' +
          '<div class="st-ov-text"><strong class="st-ov-main">Noch nichts gelöst</strong><span class="st-ov-sub"></span></div>' +
          '<a class="btn primary st-resume" href="#grundlagen" hidden></a>' +
        '</div>' +
        '<div class="st-tiles"></div>';
      var grid = el.querySelector('.st-tiles');
      tiles = {};
      chs.forEach(function (c) {
        var a = QG.h('a', { class: 'st-tile', href: '#' + c.id, 'data-color': c.color },
          '<span class="st-tile-icon" aria-hidden="true">' + esc(c.icon) + '</span>' +
          '<span class="st-tile-title">' + esc(c.title) + '</span>' +
          '<span class="st-tile-foot"><span class="st-tile-bar" aria-hidden="true"><span></span></span><span class="st-tile-count"></span></span>');
        grid.appendChild(a);
        tiles[c.id] = a;
      });
    }

    function update(per) {
      if (built !== QG.chapters.length - 1) build();
      var done = 0, total = 0;
      var last = QG.store.get('start:last', null);
      QG.chapters.forEach(function (c) {
        var p = (per && per[c.id]) || QG.progress(c.id);
        done += p.done; total += p.total;
        var a = tiles[c.id];
        if (!a) return;
        var isDone = p.total > 0 && p.done === p.total;
        a.classList.toggle('is-done', isDone);
        a.classList.toggle('is-last', c.id === last && !isDone);
        a.querySelector('.st-tile-bar > span').style.width = (p.total ? 100 * p.done / p.total : 0) + '%';
        a.querySelector('.st-tile-bar').style.visibility = p.total ? '' : 'hidden';
        a.querySelector('.st-tile-count').textContent = p.total ? (isDone ? '✓ ' : '') + p.done + '/' + p.total : ({ training: '∞ Aufgaben', 'probe-hue': 'mit Timer', spickzettel: 'zum Ausdrucken', nachhilfe: 'Leitfaden' }[c.id] || 'ansehen');
        a.setAttribute('aria-label', c.title + (p.total ? ', ' + p.done + ' von ' + p.total + ' Aufgaben gelöst' : ''));
      });
      var pct = total ? Math.round(100 * done / total) : 0;
      el.querySelector('.st-ring-fg').setAttribute('stroke-dashoffset', (CIRC * (1 - pct / 100)).toFixed(2));
      el.querySelector('.st-ring-pct').textContent = pct + ' %';
      el.querySelector('.st-ov-main').textContent = done === 0 ? 'Noch nichts gelöst – leg los!' :
        done === total ? 'Alles gelöst – stark! 🎉' : done + ' von ' + total + ' Aufgaben gelöst';
      el.querySelector('.st-ov-sub').textContent = done === 0 ? 'Starte am besten mit den Grundlagen oder dem Selbsttest.' :
        done === total ? 'Jetzt noch die Probe-HÜ unter Zeit – dann bist du bereit.' : 'Jede gelöste Aufgabe zählt.';
      var btn = el.querySelector('.st-resume');
      var lastCh = QG.chapters.filter(function (c) { return c.id === last; })[0];
      if (lastCh) {
        btn.hidden = false;
        btn.setAttribute('href', '#' + lastCh.id);
        btn.textContent = 'Weiter bei ' + lastCh.icon + ' ' + lastCh.short;
      } else if (done === 0) {
        btn.hidden = false;
        btn.setAttribute('href', '#grundlagen');
        btn.textContent = 'Mit den Grundlagen starten';
      } else btn.hidden = true;
    }

    build();
    update();
    QG.on('progress', function (d) { update(d && d.chapters); });
    QG.on('chapter', function (id) { if (id === 'start') update(); });
  });

  /* ---------- Lernplan mit Checkboxen ---------- */
  QG.widget('start-plan', function (el) {
    var KEY = 'start:plan';
    var state = QG.store.get(KEY, {}) || {};
    var days = Array.prototype.slice.call(el.querySelectorAll('.st-day'));

    days.forEach(function (day) {
      var head = day.querySelector('.st-day-head');
      var cnt = QG.h('span', { class: 'st-day-count', 'aria-live': 'polite' });
      head.appendChild(cnt);
      day._cnt = cnt;
      day.querySelectorAll('input[type="checkbox"][data-key]').forEach(function (cb) {
        cb.checked = !!state[cb.dataset.key];
        cb.addEventListener('change', function () {
          var wasDone = day.classList.contains('is-done');
          if (cb.checked) state[cb.dataset.key] = 1; else delete state[cb.dataset.key];
          QG.store.set(KEY, state);
          render();
          if (!wasDone && day.classList.contains('is-done')) {
            var n = day.getAttribute('data-day');
            QG.toast(n === '4' ? 'Lernplan komplett – du bist bereit für die HÜ! 💪' : 'Tag ' + n + ' geschafft! 💪', { type: 'ok' });
            QG.celebrate(day.querySelector('.st-day-head'));
          }
        });
      });
    });

    var foot = QG.h('div', { class: 'st-plan-foot no-print' },
      '<p class="small muted">Wird nur auf diesem Gerät gespeichert.</p>');
    var reset = QG.h('button', { type: 'button', class: 'btn ghost' }, 'Häkchen zurücksetzen');
    reset.addEventListener('click', function () {
      if (!Object.keys(state).length) return;
      state = {};
      QG.store.set(KEY, state);
      el.querySelectorAll('input[type="checkbox"]').forEach(function (cb) { cb.checked = false; });
      render();
      QG.toast('Lernplan zurückgesetzt');
    });
    foot.appendChild(reset);
    el.parentNode.insertBefore(foot, el.nextSibling);

    function render() {
      days.forEach(function (day) {
        var cbs = day.querySelectorAll('input[type="checkbox"]');
        var on = Array.prototype.filter.call(cbs, function (c) { return c.checked; }).length;
        day._cnt.textContent = on === cbs.length ? '✓ erledigt' : on + '/' + cbs.length;
        day.classList.toggle('is-done', on === cbs.length);
      });
      reset.hidden = !Object.keys(state).length;
    }
    render();
  });

  /* ---------- Selbsttest: Auswertung & Empfehlung ---------- */
  var ST_IDS = ['grund-0a', 'grund-0b', 'grund-0c'];
  var ST_KEY = 'start:selftest';
  var ST_INFO = {
    'grund-0a': {
      topic: 'Satz vom Nullprodukt',
      okTxt: 'Den Satz vom Nullprodukt kannst du schon.',
      tip: 'Lies den <a href="#gl-nullprodukt">Satz vom Nullprodukt</a> in den Grundlagen – das ist das Herzstück von Weg 2.'
    },
    'grund-0b': {
      topic: 'binomische Formeln',
      okTxt: 'Die binomischen Formeln sitzen.',
      tip: 'Wiederhole die <a href="#gl-fitcheck">binomischen Formeln im Fit-Check</a> – die brauchst du für Weg 2 und Weg 3.'
    },
    'grund-0c': {
      topic: 'Wurzel ziehen',
      okTxt: 'Wurzelziehen mit ± klappt.',
      tip: 'Schau dir <a href="#gl-anzahl">„Wie viele Lösungen?“</a> an: Bei <span class="m">x² = 16</span> gibt es <strong>zwei</strong> Lösungen (±).'
    }
  };

  QG.widget('start-selftest', function (el) {
    var res = QG.store.get(ST_KEY, {}) || {};
    // Ergebnisse aus früheren Sitzungen ohne Speicher: gelöste Aufgaben zählen als „ok“
    ST_IDS.forEach(function (id) { if (!res[id] && QG.solved(id)) res[id] = 'ok'; });

    function render() {
      var answered = ST_IDS.filter(function (id) { return res[id]; });
      if (!answered.length) { el.innerHTML = ''; return; }
      if (answered.length < ST_IDS.length) {
        el.innerHTML = '<p class="st-res-wait">' + answered.length + ' von 3 beantwortet – die Empfehlung erscheint nach der letzten Frage.</p>';
        return;
      }
      var miss = ST_IDS.filter(function (id) { return res[id] !== 'ok'; });
      var score = 3 - miss.length;
      var title, lead, items = [];
      if (score === 3) {
        title = 'Starke Basis!';
        lead = 'Du hast alles auf Anhieb gewusst. Du kannst direkt mit den drei Wegen loslegen.';
        items.push('<li class="ok"><span>Überflieg die <a href="#grundlagen">Grundlagen</a> nur kurz – vor allem „Probe“ und „Lösungsmenge notieren“.</span></li>');
        items.push('<li><span>Starte dann mit <a href="#grafisch">Weg 1: Grafisch lösen</a>.</span></li>');
      } else {
        title = score === 2 ? 'Fast alles sitzt.' : score === 1 ? 'Da ist noch Luft nach oben.' : 'Gut, dass du es jetzt weißt!';
        lead = 'Starte mit den <a href="#grundlagen">Grundlagen</a> – die drei Wege bauen genau darauf auf. Konkret:';
        miss.forEach(function (id) { items.push('<li><span>' + ST_INFO[id].tip + '</span></li>'); });
        ST_IDS.forEach(function (id) {
          if (res[id] === 'ok') items.push('<li class="ok"><span>' + ST_INFO[id].okTxt + '</span></li>');
        });
      }
      el.innerHTML = '<div class="st-res">' +
        '<h3>' + title + ' <span class="st-res-score">' + score + '/3 auf Anhieb</span></h3>' +
        '<p>' + lead + '</p><ul>' + items.join('') + '</ul>' +
        '<div class="btn-row"><a class="btn primary" href="' + (score === 3 ? '#grafisch' : '#grundlagen') + '">' + (score === 3 ? 'Zu Weg 1' : 'Zu den Grundlagen') + ' →</a>' +
        '<button type="button" class="btn ghost st-res-reset">Test wiederholen</button></div></div>';
      QG.math(el);
      el.querySelector('.st-res-reset').addEventListener('click', function () {
        res = {};
        QG.store.set(ST_KEY, res);
        QG.resetProgress('grund-0');
        render();
        var first = document.querySelector('[data-id="grund-0a"]');
        if (first) first.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }

    QG.on('task', function (e) {
      if (!e || ST_IDS.indexOf(e.id) < 0) return;
      if (e.ok) { if (e.attempts === 1) res[e.id] = 'ok'; else if (!res[e.id] || res[e.id] === 'ok') res[e.id] = 'miss'; }
      else res[e.id] = 'miss';
      QG.store.set(ST_KEY, res);
      // erst nach dem richtigen Antworten auswerten, nicht mitten im Raten
      if (e.ok) render();
    });
    render();
  });
})();
