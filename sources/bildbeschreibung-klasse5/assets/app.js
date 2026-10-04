/* Bildbeschreibung · Klasse 5 — kleine Helfer für alle Seiten */
(function () {
  // Inhaltsverzeichnis automatisch erzeugen: <nav class="toc" data-auto-toc="CSS-Selektor"></nav>
  document.querySelectorAll('[data-auto-toc]').forEach(function (toc) {
    var sel = toc.getAttribute('data-auto-toc') || 'section[id]';
    var items = document.querySelectorAll(sel);
    if (!items.length) return;
    var ol = document.createElement('ol');
    var ohneNr = false;
    items.forEach(function (el) {
      if (!el.id) return;
      var h = el.querySelector('[data-toc-titel]') || el.querySelector('h2');
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + el.id;
      var titel = el.getAttribute('data-toc-titel') || (h ? h.textContent.trim().replace(/\s+/g, ' ') : el.id);
      var nr = el.querySelector('.ab-nr b');
      if (nr && /^ab\d+$/.test(el.id) && !/^AB\s/.test(titel)) titel = 'AB ' + nr.textContent.trim() + ' · ' + titel;
      if (/^(AB\s|\d+[.:)])/.test(titel) || el.classList.contains('blatt')) ohneNr = true;
      a.textContent = titel;
      li.appendChild(a);
      ol.appendChild(li);
    });
    if (ohneNr) ol.classList.add('ohne-nr');
    toc.appendChild(ol);
  });

  // Ganze Seite drucken
  document.querySelectorAll('[data-print]').forEach(function (b) {
    b.addEventListener('click', function () { window.print(); });
  });

  // Nur das umgebende Blatt / die umgebende Stunde drucken
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-print-einzeln]');
    if (!b) return;
    var ziel = b.closest('.blatt, .stunde, [data-druckbereich]');
    if (!ziel) return window.print();
    document.body.classList.add('drucke-einzeln');
    ziel.classList.add('drucken');
    var aufraeumen = function () {
      document.body.classList.remove('drucke-einzeln');
      ziel.classList.remove('drucken');
      window.removeEventListener('afterprint', aufraeumen);
    };
    window.addEventListener('afterprint', aufraeumen);
    window.print();
  });

  // Alle Lösungen auf-/zuklappen
  document.querySelectorAll('[data-toggle-loesungen]').forEach(function (b) {
    b.addEventListener('click', function () {
      var alle = document.querySelectorAll('details.loesung');
      var oeffnen = Array.prototype.some.call(alle, function (d) { return !d.open; });
      alle.forEach(function (d) { d.open = oeffnen; });
      b.textContent = oeffnen ? 'Alle Lösungen zuklappen' : 'Alle Lösungen aufklappen';
    });
  });
})();
