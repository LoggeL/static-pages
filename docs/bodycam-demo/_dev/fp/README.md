# C18: Arme, IK und Clip-Infrastruktur prüfen

Die isolierte Seite nutzt die echte Waffenlogik, beide GLB-Modelle und die realen First-Person-Arme. Eine neutrale Prüfumgebung macht Handanschlüsse sichtbar. Welt und Layer-1-Viewmodel benutzen dieselbe Kamera mit getrennten Tiefenpuffern; das Viewmodel wird in ein eigenes Render-Target gerendert und darübergelegt.

```sh
python3 -m http.server 8967 --bind 127.0.0.1 -d public
node public/bodycam-demo/_dev/fp/acceptance.mjs
```

URL: `http://127.0.0.1:8967/bodycam-demo/_dev/fp/`. `?pause=1` friert die Simulation ein, `?markers=0` blendet die Zielmarkierungen aus. Die Schalter zeigen Bereitschaft, ADS, beide Reloads, Sprint, Inspect, freie/gelöste linke Hand und Fingerpresets. Eine neue Instanz setzt Munition und Handziele zurück. Die Haltungsschalter geben echte Zustandswünsche an die Waffenlogik; laufende gesperrte Zustände enden regulär.

`window.fpTest` stellt `ready`, `weapon`, `arms`, `scene`, `camera`, `renderer`, `world`, `bus`, `freeTarget`, `viewmodelTarget`, `stats()`, `step(seconds)`, `freeze(on)`, `look(yawDeg,pitchDeg)`, `turn(degrees,seconds)`, `setPose(name)`, `setTarget(side,nameOrObject,blend)`, `setArmsVisible(on)`, `setMarkers(on)`, `setMoving(on)`, `createInstances()`, `benchmark(opts)`, `render()` und `dispose()` bereit. Zielnamen: `grip`, `magwell`, `magazine`, `free`, `release`. `step()` integriert in höchstens 1/120 s. `look()` setzt die Kamera als Schnitt ohne Restträgheit, `turn()` dreht kontinuierlich und übt den echten Waffen-Sway aus.

Abnahmeberichte und PNGs gehen ausschließlich nach `/Users/logge/Documents/Projects/bodycam-work/codex/C18/{reports,screenshots}/`. Das Playwright-Programm nutzt Chromium 1243 mit Metal, misst echte Handknochen gegen Ziele, vergleicht Handrotationen, prüft Fingerüberblendung, beide Reloads, Layer, Instanzfreigabe, Neuaufbau und mobile Größe. Der Benchmarks-Baseline blendet Arme aus und überspringt deren Update, entsprechend dem früheren Waffenpfad. Er misst den isolierten technischen Renderaufwand ohne Framelimit; die Gesamtdemo wird gesondert geprüft.

Umgebungsvariablen: `C18_URL`, `C18_WORK`, `CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`. Den eigenen Server nach der Prüfung beenden. Kein App-Build und keine Dateien nach `docs/`.
