import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const puppeteer = require('/Users/logge/Documents/Projects/learn-guide/node_modules/puppeteer');

const BASE_URL = 'http://localhost:4173';
const PREVIEW_PATH =
  process.argv[2] ||
  '/Users/logge/Documents/Projects/static-pages/previews/sozialpaedagogik-lernen.webp';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`console.error: ${msg.text()} (${msg.location()?.url || ''})`);
    }
  });

  // 1. Dashboard prüfen & Vorschaubild erzeugen
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  const unitLinks = await page.$$eval('main a[href*="#/einheit/"]', (els) =>
    new Set(els.map((el) => el.getAttribute('href'))).size
  );
  console.log('Dashboard unique unit links:', unitLinks);
  assert.equal(unitLinks, 50, `Expected 50 unit links on dashboard, got ${unitLinks}`);

  // Warte kurz für Google Fonts / Animationen und erstelle Screenshot
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: PREVIEW_PATH, type: 'webp', quality: 90 });
  console.log('Preview screenshot saved to:', PREVIEW_PATH);

  // 2. Einheit 15 öffnen, Tabs testen & localStorage Persistenz verifizieren
  await page.goto(`${BASE_URL}/#/einheit/15-sp2-bindung-beziehung-erziehungsstile`, {
    waitUntil: 'networkidle0',
  });
  await page.waitForSelector('h1');
  const svgCount = await page.$$eval('main svg', (els) => els.length);
  console.log('Unit 15 SVGs rendered:', svgCount);
  assert.ok(svgCount >= 2, 'Expected interactive SVGs in Unit 15');

  // Helper: Button per Text klicken
  const clickButtonContaining = async (text) => {
    const clicked = await page.evaluate((needle) => {
      const btns = Array.from(document.querySelectorAll('button'));
      const target = btns.find((b) => (b.textContent || '').includes(needle));
      if (!target) return false;
      target.click();
      return true;
    }, text);
    assert.ok(clicked, `Button containing "${text}" not found`);
  };

  // Tab Praxis-Fallbeispiel
  await clickButtonContaining('Praxis-Fallbeispiel');
  await new Promise((r) => setTimeout(r, 250));
  // Im Step 1 und Step 2 jeweils erste Handlungsoption (Badge === 'A') anklicken
  await page.evaluate(() => {
    const optButtons = Array.from(document.querySelectorAll('main button')).filter((b) => {
      const firstSpan = b.querySelector('span');
      return firstSpan && ['A', 'B', 'C'].includes((firstSpan.textContent || '').trim());
    });
    if (optButtons[0]) optButtons[0].click();
    if (optButtons[3]) optButtons[3].click();
  });

  // Tab Lernkarten
  await clickButtonContaining('Lernkarten');
  await new Promise((r) => setTimeout(r, 250));
  await clickButtonContaining('Gewusst');

  // Tab Einheiten-Quiz komplett durchspielen
  await clickButtonContaining('Einheiten-Quiz');
  await new Promise((r) => setTimeout(r, 250));

  for (let q = 0; q < 10; q++) {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('main button')).some((b) =>
          (b.textContent || '').includes('Antwort prüfen')
        ),
      { timeout: 4000 }
    );
    // Erste Antwortoption (Badge === 'A') anklicken
    const clickedOpt = await page.evaluate(() => {
      const optBtns = Array.from(document.querySelectorAll('main button')).filter((b) => {
        const firstSpan = b.querySelector('span');
        return firstSpan && ['A', 'B', 'C', 'D'].includes((firstSpan.textContent || '').trim());
      });
      if (optBtns[0]) {
        optBtns[0].click();
        return true;
      }
      return false;
    });
    assert.ok(clickedOpt, `Quiz option A not found on question ${q + 1}`);
    await new Promise((r) => setTimeout(r, 80));
    await clickButtonContaining('Antwort prüfen');
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('main button')).some(
          (b) =>
            (b.textContent || '').includes('Nächste Frage') ||
            (b.textContent || '').includes('Quiz auswerten & speichern')
        ),
      { timeout: 4000 }
    );

    const hasNext = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button')).some((b) =>
        (b.textContent || '').includes('Nächste Frage')
      )
    );
    if (hasNext) {
      await clickButtonContaining('Nächste Frage');
      await new Promise((r) => setTimeout(r, 420));
    } else {
      await clickButtonContaining('Quiz auswerten & speichern');
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 200));

  // localStorage prüfen
  const savedBeforeReload = await page.evaluate(() =>
    window.localStorage.getItem('sozpaed_lp_rlp_progress_v1')
  );
  assert.ok(savedBeforeReload, 'localStorage must contain sozpaed_lp_rlp_progress_v1');
  const parsedBefore = JSON.parse(savedBeforeReload);
  assert.ok(
    parsedBefore.quizResults['15-sp2-bindung-beziehung-erziehungsstile'],
    'Quiz result for unit 15 must be stored'
  );
  assert.ok(
    parsedBefore.flashcardMastery['15-sp2-bindung-beziehung-erziehungsstile']?.some(Boolean),
    'Flashcard mastery must be stored'
  );
  assert.equal(
    parsedBefore.caseStudyCompleted['15-sp2-bindung-beziehung-erziehungsstile'],
    true,
    'Case study completion must be stored'
  );

  // Reload & Persistenz prüfen
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  const savedAfterReload = await page.evaluate(() =>
    window.localStorage.getItem('sozpaed_lp_rlp_progress_v1')
  );
  assert.equal(savedAfterReload, savedBeforeReload, 'Progress must survive page reload');
  console.log('localStorage persistence verified across reload!');

  // 3. Stundentafel prüfen
  await page.goto(`${BASE_URL}/#/stundentafel`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await clickButtonContaining('Berufsbegleitend');
  await clickButtonContaining('Selbstlernzeiten');
  const stundenText = await page.evaluate(() => document.body.innerText);
  assert.ok(stundenText.includes('2.400') || stundenText.includes('2400'), 'Stundentafel text missing');

  // 4. Prüfungstrainer prüfen
  await page.goto(`${BASE_URL}/#/pruefung`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await clickButtonContaining('Prüfungstraining starten');
  await new Promise((r) => setTimeout(r, 200));
  const examBody = await page.evaluate(() => document.body.innerText);
  assert.ok(examBody.includes('Prüfungsfrage 1 /'), 'Exam runner did not start');

  // 5. Glossar prüfen
  await page.goto(`${BASE_URL}/#/glossar`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  const glossarBody = await page.evaluate(() => document.body.innerText);
  assert.ok(glossarBody.includes('Treffer angezeigt'), 'Glossar did not render');

  assert.equal(errors.length, 0, `Browser errors detected:\n${errors.join('\n')}`);
  console.log('ALL 5 ROUTES & LOCALSTORAGE SMOKE TESTS PASSED WITH 0 ERRORS!');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
