# Veil

**Face redaction that never leaves the browser tab.** Drop in a photo, an on-device model
finds every face, censor them with one of five treatments, export at full resolution — and
pay one credit per redacted face.

There is no upload step, because there is no server. Decoding, detection, compositing and
encoding all run in the page.

```bash
npm install       # also self-hosts the MediaPipe runtime, BlazeFace models and fonts
npm run dev       # http://localhost:5173
npm run build     # type-check + bundle to dist/
npm run preview   # serve the production build
```

## Why it is browser-only

Most "remove faces" tools ask you to hand a private photograph to somebody else's GPU. Veil
does the opposite: the model ships to you, the photo never moves. The only bytes that leave
the machine are the ones fetching this app in the first place — and after `npm install`,
even the model weights, the WASM runtime and the webfonts are served from your own origin.

## What it does

**Studio**

- Drop, paste or browse for an image (PNG / JPEG / WebP / AVIF, up to 40 MB), or open one of
  six bundled sample photos.
- Automatic detection runs both BlazeFace variants — short-range and full-range — and merges
  their output, so a close-up portrait and a group around a table are handled in the same
  pass. A sensitivity control trades recall against false positives, and the honest limits of
  the model are documented below rather than hidden.
- Everything detection produces is editable: drag to move, eight handles to resize, arrow keys
  to nudge (`Shift` for bigger steps), `Delete` to remove, `Escape` to deselect, and a draw
  tool for anything the model missed. 40 steps of undo/redo.
- Five treatments — feathered blur, mosaic, solid redaction bar, analogue static and emoji
  glyph — each with independent strength, edge feather and coverage, per region.
- A before/after divider that clips the composited canvas, so you can check the result before
  spending anything.
- Export to PNG, JPEG or WebP at original resolution or a capped edge (8192 / 4096 / 2048 /
  1280 px). Copying to the clipboard is always free.

**Credits**

- 1 credit per redacted face, with a one-credit floor per export. A three-person photo costs
  three credits; the cost is shown before you commit.
- 25 welcome credits on first run, a full ledger of every transaction, three one-off packs
  and three subscription tiers.
- Credits are charged only after the image has been successfully encoded, so a failed export
  never costs anything.

**Library** — every export is kept as a local thumbnail with its face count, credit cost and
treatment, stored in IndexedDB.

## Test-mode payments

The checkout is a complete, working card flow — Luhn validation, expiry and CVC checks,
inline errors, a processing state, an order reference and a real ledger entry. It is wired to
a local simulated provider rather than a live processor. **No card is charged and nothing is
transmitted.** The UI labels this unmissably, and a "use test card" button fills
`4242 4242 4242 4242`.

Swapping in a real processor means replacing the two grant calls in the `pay()` function of
`src/routes/Checkout.tsx` (`purchasePack` / `subscribe`) with a server round-trip that confirms
the charge first. The order summary, validation, ledger and entitlement logic around them do
not change — credits are only granted once the provider returns.

## Architecture

```
src/
  lib/
    detect.ts      MediaPipe BlazeFace: two models, NMS merge, score floor from sensitivity
    imaging.ts     canvas compositor: effect surface + blurred mask, resolution-independent
    types.ts       normalised box geometry, region model, presets, resize maths
    pricing.ts     the credit economy in one place
    samples.ts     bundled demo photography
  store/           zustand: credits, account, library (IndexedDB), studio session, toasts
  components/
    studio/        StageCanvas, Dropzone, SourcePanel, RegionList, Inspector, ExportPanel
    ui/            Button, Dialog, Toaster, primitives (Field, Slider, Badge, …)
    chrome/        SiteHeader, SiteFooter, layouts
  routes/          Landing, Studio, Pricing, Checkout, Account, Library, Legal
```

**Detection.** `detectFaces()` downscales to a 1280 px working canvas, runs both detectors
with a deliberately permissive confidence floor, widens each box the way a redaction needs
(hairline and chin included), merges duplicates by IoU, then applies the user's sensitivity as
a score filter — so changing sensitivity is instant instead of rebuilding the graph.

**Compositing.** Every region is painted into a reusable scratch surface: the effect is applied
at the crop, a second surface is filled with the region's shape and blurred for the feathered
edge, and the two are combined with `destination-in` before landing on the target canvas.
Effect sizes are derived from the region's shorter side rather than absolute pixels, so the
interactive preview and the full-resolution export are pixel-for-pixel the same treatment.

**Performance.** Preview renders are capped at a 1700 px backing store and batched into a
`requestAnimationFrame`; the scratch canvases are module-scoped and reused, so dragging a
region does not allocate per frame.

## Self-hosted assets

`scripts/setup-assets.mjs` (run automatically on `postinstall`) copies the MediaPipe WASM
runtime out of `node_modules`, downloads both `.tflite` models, and pulls the latin subsets of
Inter Tight, JetBrains Mono and Instrument Serif. All of it lands in `public/` and is served
from your own origin; nothing is fetched from a CDN at runtime.

## Accessibility

Semantic landmarks, labelled controls, `aria-pressed` toggles, focus-trapped dialogs with
Escape handling, live-region toasts, visible focus rings, keyboard-only region editing, and a
`prefers-reduced-motion` path that disables the scan and reveal animations.

## Known limits

Detection is best-effort, and it is worth being precise about how.

- BlazeFace emits plausible-looking faces at low confidence on things that are not faces —
  the back of a head, clasped hands, background clutter. Measured across the bundled samples,
  those false positives live in the 0.38–0.6 confidence band, so the balanced default sits at
  0.48 and the slider reaches down to 0.30 only when you ask for it.
- Small faces are the real failure mode. The model's input is a fixed 128 px square, so a face
  occupying less than roughly 4% of the frame is beyond it regardless of how large the source
  file is. Tiling the image does not help — the resize is proportional, so a crop loses exactly
  as much as it gains. Crowded wide shots will need manual regions.
- Weak detections are labelled rather than hidden: any auto region under 62% confidence is
  flagged `check` in the region list and tinted in the inspector, because those are the ones
  most likely to be wrong.
- Always verify the export before publishing it. The before/after divider and the free
  clipboard copy exist precisely so that check costs nothing.
- The bundled sample photography is from Unsplash, used under the Unsplash licence.
- Everything persists locally (`localStorage` + IndexedDB). Clearing site data resets the
  credit ledger, the session label and the library.
