# Herstellerneutraler CAD-Connector-Vertrag V1

Stand: 2026-08-26
Status: normative Architektur- und Onboarding-Grundlage; konkrete Adapter bleiben
versions- und evidenzgebunden
Schema: [`cad-connector-contract-v1.schema.json`](cad-connector-contract-v1.schema.json)
Beispiel: [`cad-connector-solid-edge-2026.example.json`](cad-connector-solid-edge-2026.example.json)
KiCad-Parität: [`cad-connector-kicad.example.json`](cad-connector-kicad.example.json)

## 1. Zweck und Geltungsbereich

Dieser Vertrag definiert die gemeinsame **Seam** zwischen iV Connect und lokal
oder serverseitig laufenden CAD-Systemen. Er trennt drei Dinge, die nicht
vermischt werden dürfen:

1. das kanonische CAD-Modell, das iV Connect versteht,
2. die herstellerspezifischen APIs und Dateiformate hinter einem Adapter,
3. die Evidenz, unter welchen Versionen, Startmodi und Qualitätsgrenzen eine
   Fähigkeit tatsächlich verifiziert wurde.

Der Vertrag gilt für MCAD und kann auch von ECAD-Adaptern verwendet werden,
wenn deren domänenspezifische Entitäten über explizite Erweiterungen ergänzt
werden. Er ersetzt weder das separate `ECAD_PLM_CANONICAL_MODEL_V1` noch den
separaten `ProjectSnapshot`-Flow.
Er legt davor fest, **wie** ein CAD-Adapter Fähigkeiten entdeckt, eine
konsistente Quelle liest und belegte kanonische Daten an den Snapshot-Flow
übergibt.

V1 umfasst:

- Projekte, Dokumente, Teiledefinitionen, Occurrences und Baugruppenstruktur,
- Engineering-BOM und sichtbare Parts Lists,
- Standard-, Custom- und physikalische Eigenschaften,
- native und abgeleitete Artefakte einschließlich STEP und PDF,
- Capability-, Startmodus-, Provenienz-, Qualitäts- und Performance-Evidenz,
- Read-, Capture- und kontrollierte Write-Verträge,
- Primär-/Fallback-Auswahl und Fail-closed-Regeln.

V1 verspricht keine vollständige Feature-Historie, keine universelle
parametrische Geometrieübersetzung und keine Gleichheit zwischen Engineering-,
Manufacturing- und Service-BOM.

## 2. Architekturentscheidung: ein tiefes CAD-Connector-Modul

Das CAD-Connector-Modul besitzt eine kleine externe **Interface**. Alle
Herstellerbesonderheiten, COM-/IPC-Threadingregeln, Dateisperren, Add-in-
Registrierung, CLI-Argumente, SDK-Typen und Exportdialoge bleiben in seiner
**Implementation**. Ein Solid-Edge-, KiCad-, EPLAN- oder anderer CAD-Adapter
sitzt an derselben Seam.

Konzeptionell umfasst die Interface nur vier Operationen:

```text
inspect(context) -> CapabilityManifest
capture(request) -> CaptureReceipt + CanonicalCadSnapshot
plan_write(change_set, expected_source_version) -> CadWritePlan
execute_write(authorized_plan) -> CadWriteReceipt
```

- `inspect` ist read-only und erfindet keine Fähigkeiten. Es liefert eine
  versions- und umgebungsgebundene Capability-Matrix.
- `capture` erzeugt einen unveränderlichen, qualitätsmarkierten Snapshot. Die
  gewählte Hersteller-API ist kein Wissen des Callers.
- `plan_write` erzeugt nur eine Vorschau mit Zielversion, Operationen,
  Auswirkungen und Rollback-Plan.
- `execute_write` akzeptiert ausschließlich einen unveränderten, autorisierten
  Plan und liefert einen nativen Read-back.

Tests benutzen dieselbe Interface wie die Runtime. Fake-Adapter werden nicht
vor die echten Adapter geschichtet, sondern ersetzen sie am Test-Seam. Da mit
KiCad und Solid Edge bereits zwei reale Implementierungen existieren, ist
diese Seam nicht hypothetisch.

## 3. Verbindliche Begriffstrennung

| Begriff | Bedeutung | Darf nicht ersetzt werden durch |
|---|---|---|
| `PartDefinition` | Wiederverwendbare Teiledefinition mit eigenen Identitäten und Eigenschaften | eine konkrete Einbauposition |
| `ComponentOccurrence` | Konkrete Verwendung einer Teiledefinition innerhalb genau einer Struktur | aggregierte BOM-Zeile |
| `AssemblyStructure` | Hierarchische Parent-/Child-Struktur aus Occurrences | flache BOM |
| `BOMSnapshot` | Stückliste für genau eine explizit aufgelöste Konfiguration und einen BOM-Typ | Parts-List-PDF oder STEP-Inhalt |
| `Artifact` | Native oder abgeleitete Datei mit Hash, Rolle und Provenienz | kanonisches Quellobjekt |
| `ObservedValue` | Wertzustand `value`, `null` oder `unavailable` mit Qualität und Provenienz | unmarkierter JSON-Wert |
| `Capability` | Eine belegte fachliche Fähigkeit des Adapters | bloß vorhandene Herstellerklasse oder Menüfunktion |
| `Route` | Konkreter Herstellerzugriff, der Fähigkeiten erfüllen kann | die Capability selbst |

Eine Teiledefinition und ihre Occurrences bleiben getrennt, auch wenn ein
Herstellersystem nur aggregierte BOM-Zeilen liefert. In diesem Fall wird
`quantity_mode = aggregate_without_occurrences` gesetzt; der Adapter darf
keine synthetischen Occurrences als native Beobachtung ausgeben.

## 4. Kanonische Entitäten

| Entität | Pflichtidentität | Kerninhalt | Invarianten |
|---|---|---|---|
| `CadProject` | `source_object_urn` | Name, Konfiguration, Root-Dokumente | verweist nur auf Dokumente desselben Snapshots |
| `CadDocument` | `source_object_urn` | Typ `part`, `assembly`, `drawing`, native Revision, Save-State | nativer Typ und Quellsystem bleiben erhalten |
| `PartDefinition` | `source_object_urn` | Part Number, Revision, Beschreibung, Material, Make/Buy, Klassifikation | Kennungen sind Matchingmerkmale, nicht die technische Identität |
| `ComponentOccurrence` | `source_object_urn` | Parent, Child-Part, Transform, Suppression, BOM-Inclusion, Referenzstatus | genau ein Parent und genau eine Teiledefinition |
| `AssemblyStructure` | Root-Dokument-URN | geordnete Occurrence-Kanten | keine Zyklen; fehlende Child-Referenzen blockieren vollständige Struktur |
| `BOMSnapshot` | Snapshot-lokale ID | BOM-Typ, Konfiguration, Grouping Rule, Positionen | genau eine Konfiguration und ein deklarierter BOM-Typ |
| `BOMPosition` | deterministische Positions-ID | Parent, Child, Occurrence-Refs, Menge, Einheit | Menge folgt dem deklarierten `quantity_mode` |
| `PropertyValue` | Objekt-URN + kanonischer Feldpfad | typisierter Wert, Einheit, Owner, Provenienz | `unavailable`, `null` und `value` bleiben verschieden |
| `GeometrySummary` | Dokument-URN | Bounding Box, Feature-Zähler, Einheiten | Summary ist keine portable parametrische Geometrie |
| `PhysicalProperties` | Dokument-URN | Masse, Volumen, Fläche, Schwerpunkt, Berechnungsstatus | Werte ohne gültige Material-/Update-Basis werden nicht `source_verified` |
| `Artifact` | Snapshot-lokale ID + SHA-256 | Rolle, Media Type, Größe, Origin, Storage Ref | native und generierte Artefakte werden getrennt |
| `ValidationFinding` | stabiler Fehlercode | Severity, Objektbezug, Evidenz, Retry-Klasse | blockierende Findings verhindern `verified` |

Kanonische IDs verwenden stabile URNs, beispielsweise
`urn:iv:cad:solid-edge:document:<opaque-native-id>`. Absolute Benutzerpfade,
Dateinamen allein und Array-Indizes sind keine dauerhaften Identitäten. Ist im
Quellsystem keine stabile ID verfügbar, muss der Adapter die verwendete,
versionierte Ableitungsregel dokumentieren und die Qualität begrenzen.

## 5. BOM- und Analysevertrag aus der Ofen-Fixture

Die Ofen-Fixture in
[`SolidEdgeOvenDemo.cs`](../source/SolidEdgeOvenDemo.cs) ist die erste
MCAD-Golden-Fixture für diesen Vertrag. Die produktive rekursive Abnahme nutzt
zusätzlich `SolidEdgeLargeAssemblyDemo.cs`: elf Teiledefinitionen, vier
Unterbaugruppen, 210 expandierte Knoten, Suppression, Reference-only- und
per-Instanz ausgeschlossene Occurrences sowie eine native Atomic Parts List.
Gemeinsam decken beide Fixtures Wiederholteile, Make/Buy, Materialien,
Kategorien, Analyse-Tags sowie native, STEP-, PDF-, BOM- und
Analyseartefakte ab.

Die Fixture belegt folgende Semantik, ohne die Solid-Edge-Typnamen in das
kanonische Modell zu übernehmen:

| Beobachtung in der Fixture | Kanonische Bedeutung | Qualitätsregel |
|---|---|---|
| `AssemblyDocument.Occurrences` | `AssemblyStructure` und einzelne `ComponentOccurrence`s | erst nach vollständiger Traversierung und Referenzprüfung `source_verified` |
| `Occurrence.IncludeInBom` | BOM-Inclusion einer Occurrence | ausgeschlossene Occurrences bleiben in der Struktur erhalten |
| `SummaryInfo` | Standardmetadaten eines Dokuments | natives Feld mit Quellpfad und Owner `source_system` |
| `Properties.Custom` | domänenspezifische Properties | nur allowlisted und typisiert kanonisieren |
| `PhysicalProperties` | Masse, Volumen, Fläche und Schwerpunkt | `is_sick`, Update-Status und Einheit müssen mitgeführt werden |
| `Draft.PartsLists` | sichtbare, abgeleitete Parts List | ist ein Ausgabeartefakt, nicht die primäre BOM-Quelle |
| `SaveCopyAs` | natives Staging und neutraler Export | Dateisignatur, Größe und Hash nach dem Schließen prüfen |
| Fixture-Placement-Vertrag | Design Envelope und bekannte Positionen | als `derived_verified`, niemals als nativ gemessene CAD-Geometrie markieren |

Die rekursive Abnahme ist ausgeführt: Der positive Lauf liest 210 Knoten und
160 BOM-relevante Endvorkommen nach Save/Close/Reopen, vergleicht elf von elf
Mengen gegen die native Parts List und prüft Suppression, Reference-only sowie
per-Instanz-Ausschlüsse. Separate Negativfixtures blockieren eine fehlende
Referenz und einen Selbstzyklus fail-closed. Der vollständige gespeicherte
Dependency-Linkgraph wird über Revision Manager ermittelt, pro Zielinhalt
gehasht, kanonisch verdichtet und als eigenes Artefakt in den Bundle-Content-
Hash aufgenommen. Die Live-Occurrence-Traversierung bleibt getrennt, weil ein
persistiert unterdrückter Link nach Reload nicht mehr in der Collection
erscheint.

Eine Parts List im Draft oder PDF ist nicht gleichbedeutend mit einer
kanonischen BOM. OCR, PDF-Tabellen oder STEP-Strukturen dürfen nur als
explizit markierte Discovery-Hinweise dienen, niemals als stiller Fallback für
eine freizugebende Engineering-BOM.

## 6. Capability-Registry V1

| Capability | Ergebnis | Mindestqualität | Typische Primärroute | Zulässiger Fallback |
|---|---|---|---|---|
| `cad.observe.active_document` | aktives Dokument und Typ | `source_observed` | In-process Add-in oder Live-Automation | keiner ohne laufenden Editor |
| `cad.observe.unsaved_state` | explizit enthaltene ungesicherte Änderungen | `source_verified` | In-process/Live-SDK | kein Disk- oder Export-Fallback |
| `cad.read.project_metadata` | Projekt- und Dokumentmetadaten | `source_verified` | native SDK-/Automation-API | versionierter nativer File-Parser |
| `cad.read.custom_properties` | allowlisted Custom Properties | `source_verified` | native Property-API | versionierter nativer File-Parser |
| `cad.read.assembly_structure` | vollständige Definition-/Occurrence-Struktur | `source_verified` | native Assembly-API | offizieller, verlustfrei belegter Batch-/Serverexport |
| `cad.read.engineering_bom` | konfigurationsgebundene Engineering-BOM | `derived_verified` | Occurrences + versionierte Grouping Rule | native BOM-API mit deklariertem Quantity Mode |
| `cad.read.geometry_summary` | Bounding Box und Feature-Summary | `source_observed` | native Geometrie-API | validierter neutraler Export, begrenzte Qualität |
| `cad.read.physical_properties` | Masse, Volumen, Fläche, Schwerpunkt | `source_verified` | native Physical-Property-API | keiner, außer Herstellerbatch mit identischem Vertrag |
| `cad.export.native_snapshot` | entsperrte native Dokumente | `source_verified` | native Save-Copy-/Pack-and-go-Funktion | gespeicherte Quelldateien nur bei belegter Konsistenz |
| `cad.export.neutral_geometry` | STEP/JT/anderes vereinbartes Format | `derived_verified` | Herstellerexport | offizieller CLI-/Serverexport |
| `cad.export.drawing_pdf` | aktualisierte Zeichnung als PDF | `derived_verified` | native Draft-/Print-API | Hersteller-CLI; OS-Druck nur mit Signatur-/Renderprüfung |
| `cad.export.bom` | deterministisches BOM-JSON/CSV | `derived_verified` | kanonische BOM-Projektion | nativer strukturierter BOM-Export |
| `cad.ui.addin_command` | sichtbarer, nativer Einstieg | `source_observed` | In-process Add-in | Companion-App; kein UI-Klickroboter |
| `cad.events.document_changed` | native Änderungsereignisse | `source_observed` | Add-in/SDK Events | Polling nur explizit als Polling deklarieren |
| `cad.write.properties` | kontrollierte Property-Änderung | `source_verified` nach Read-back | native Write-API | versionierter File-Writer mit Roundtrip-Test |
| `cad.write.model` | kontrollierte Modelländerung | `source_verified` nach Regeneration und Read-back | native Modell-API | kein UI-Automation-Fallback |
| `cad.write.structure` | kontrollierte Baugruppenänderung | `source_verified` nach Read-back | native Assembly-API | kein neutraler Datei-Fallback |

`unsupported` und `unknown` sind normale, explizite Capability-Zustände. Ein
Adapter darf eine nicht verifizierte Fähigkeit nicht durch ein leeres Ergebnis
oder einen lokalen Erfolg simulieren.

## 7. Hersteller-API-Familien und Auswahlregeln

| API-Familie | Typischer Nutzen | Stärke | Grenze |
|---|---|---|---|
| `in_process_addin` | aktive Dokumente, Events, UI-Command, ungesicherter Zustand | höchste Editor-Nähe | nur wenn Add-in im konkreten Startmodus geladen ist |
| `live_automation` | Objektmodell, Modellierung, Struktur, Exporte | hohe native Treue und große Abdeckung | laufender Prozess, Session-/Threading- und Busy-Regeln |
| `vendor_cli` | reproduzierbare Exporte und Batchläufe | gut automatisierbar, teils headless | oft weniger Live- und Metadatenzugriff |
| `vendor_server_api` | freigegebene, zentrale Daten und skalierbare Jobs | unabhängig vom Desktopstart | nicht automatisch identisch mit lokalem Editorstand |
| `native_file` | disk-backed Snapshot und Offline-Metadaten | stabil, editorunabhängig | keine ungesicherten Änderungen; Schema versionsabhängig |
| `exchange_file` | neutrale Geometrie oder Zeichnung | portabel und gut prüfbar | verliert oft Identitäten, History, BOM- und Custom-Property-Semantik |
| `ui_automation` | Installation, Demo-Rehearsal, Dialogdiagnose | erreicht sichtbare UI ohne SDK | keine autoritative Datenroute und keine unbeaufsichtigte Write-Route |

Die Routenauswahl erfolgt pro Capability, Startmodus und Operation:

1. Nur Routen mit passender Produkt-/Build-, Plattform- und Startmodus-Evidenz
   sind Kandidaten.
2. Quelltreue, Konsistenz und Mindestqualität sind harte Gates. Geschwindigkeit
   wird erst danach verglichen.
3. Unter gleichwertigen Kandidaten gewinnt die Route mit dem niedrigsten
   gemessenen p95 derselben Fixture- und Umgebungsklasse.
4. Ein Fallback muss vor dem Lauf deklariert und für dieselbe Capability
   getestet sein. Er darf nie still aktiviert werden.
5. Der tatsächlich verwendete `route_id`, Grund und Fallback-Fehlercode werden
   pro Ergebnis protokolliert.
6. `ui_automation` darf keine native Lese- oder Schreibfähigkeit ersetzen.
7. Exchange-Dateien sind abgeleitete Artefakte. Sie werden nicht nachträglich
   zur Autorität für Identität, BOM oder Custom Properties erklärt.

Eine schnellere API ist daher nur dann „besser“, wenn sie dieselbe fachliche
Operation mit mindestens derselben Qualität und demselben Konsistenzvertrag
erfüllt.

## 8. Startmodi und Add-in-Verfügbarkeit

| Startmodus | Erwartbare Routen | Add-in-Regel | Verbindlicher Test |
|---|---|---|---|
| `interactive_normal` | Add-in, Live-Automation, Dateien | nur nach realem Load-Event als verfügbar markieren | normaler Start, Dokument öffnen, Command auslösen |
| `interactive_file_open` | Add-in, Live-Automation, Dateien | Dateidoppelklick darf nicht mit normalem Start gleichgesetzt werden | je nativem Root-Dateityp separat testen |
| `interactive_existing_process` | Live-Automation, eventuell Add-in | Attach nur in kompatibler User-/Desktop-Session | laufende Instanz finden, Identität und Dokument prüfen |
| `automation_spawned` | Live-Automation, eventuell Add-in | Hersteller kann Add-ins hier unterdrücken; Zustand bleibt bis zum Test `unknown` | Prozess per offizieller Automation starten und Load belegen |
| `headless_batch` | Vendor CLI, Server-API, Dateien | In-process Add-in ist `not_applicable` | ohne interaktiven Desktop und ohne modale Dialoge testen |
| `server_managed` | Vendor Server API | Desktop-Add-in ist `not_applicable` | Serverrevision und Berechtigung gegen Read-back prüfen |
| `safe_or_recovery` | meist nur eingeschränkte Datei-/Diagnoserouten | Drittanbieter-Add-ins gelten als nicht verfügbar, bis Gegenteil belegt | Hersteller-Safe-Mode explizit ausführen |
| `windows_service_session` | Server-/CLI-Routen | Desktop-Add-in und GUI-Automation sind wegen Session-Isolation nicht zulässig | Job muss ohne Desktop auskommen oder früh abbrechen |

Der Capability-Status gilt nicht global. Er ist das Produkt aus
`Produktbuild × OS/Architektur × Connectorbuild × Startmodus × Route`.
Insbesondere darf ein erfolgreicher Add-in-Load nach manuellem Start nicht auf
Dateidoppelklick, Automation-Start, Safe Mode oder Windows-Service-Ausführung
hochgerechnet werden.

## 9. Provenienz- und Qualitätsvertrag

Jeder kanonische Wert wird als `ObservedValue` behandelt:

```text
state: value | null | unavailable
value: typisierter Wert oder null
quality: source_verified | derived_verified | source_observed |
         inferred | unavailable | conflicting
provenance_ref: Verweis auf eine vollständige Provenienz
```

Eine Provenienz enthält mindestens:

- Connector-, Adapter- und Route-ID einschließlich Version,
- Hersteller, Produkt, Produktbuild, OS und Architektur,
- native Objektidentität und nativen Feld-/Methodenpfad,
- Startmodus, Save-State und Quellrevision,
- UTC-Beobachtungszeit und Correlation-ID,
- angewandte Transformationen mit Version,
- Evidenzreferenzen und Hashes der relevanten Artefakte.

Qualitätsstufen:

| Stufe | Bedeutung | Zulässige Nutzung |
|---|---|---|
| `source_verified` | nativ gelesen und durch Read-back oder fachliche Invariante bestätigt | autoritative Snapshot-Felder und Write-Verifikation |
| `derived_verified` | deterministisch aus verifizierten Quellen mit versionierter Transformation berechnet | BOM-Aggregation, Analysen, neutrale Exporte |
| `source_observed` | nativ gelesen, aber nicht unabhängig verifiziert | Anzeige und nichtkritische Analyse |
| `inferred` | aus Name, Pfad, Tag, Geometrie oder Heuristik abgeleitet | Vorschlag; niemals stiller Master oder Write-Grundlage |
| `unavailable` | Route kann den Wert nicht liefern | expliziter Capability-Gap |
| `conflicting` | mehrere Quellen widersprechen sich | blockiert Profil und Write bis zur Auflösung |

Die Qualität eines abgeleiteten Werts kann niemals höher sein als die
schwächste relevante Eingabe plus die belegte Qualität der Transformation.
Ein Fixture-Vertrag kann eine erwartete Größe verifizieren, aber keine native
CAD-Messung vortäuschen.

## 10. Capture-Profile

| Profil | Pflichtfähigkeiten | Optionale Fähigkeiten | Ergebnis bei Pflicht-Gap |
|---|---|---|---|
| `cad-part-snapshot-v1` | Metadaten, native Quelle, neutrale Geometrie | Drawing PDF, Physical Properties | Capture abweisen |
| `cad-assembly-bom-v1` | Metadaten, vollständige Struktur, Engineering-BOM, native Quellen, neutrale Geometrie, BOM-Export | Drawing PDF, Physical Properties, Geometry Summary | Capture abweisen |
| `cad-editor-live-v1` | aktives Dokument, ausdrücklich verifizierter Save-State | ungesicherter Zustand, Events | verlangte ungesicherte Daten bei Gap abweisen |
| `cad-analysis-v1` | kanonischer Part-/Occurrence-/BOM-Snapshot | Physical Properties, Geometrie-Summary | nur deklarierte optionale Analysen auslassen |

Ein optionaler Gap darf `partial` ergeben, wenn das Profil dies ausdrücklich
zulässt. Eine fehlende Pflichtfähigkeit, unvollständige Struktur oder
inkonsistente Quellrevision ergibt niemals `partial`, sondern `failed`.

## 11. Performance-Vertrag

Performance-Evidenz ist nur vergleichbar, wenn mindestens folgende Felder
gleich sind: Produktbuild, OS/Architektur, VM-/Hardwareklasse, Connectorbuild,
Startmodus, Route, Operation, Fixture-Version, Cold/Warm-State und
Konsistenzmodus.

Pro Vergleich werden erfasst:

- ein Kaltlauf,
- ein nicht gewerteter Warm-up,
- mindestens zehn gewertete Wiederholungen, bei großen Assemblies mindestens fünf,
- `sample_count`, Median, p95, Maximum und Fehlerquote,
- die funktionale Validierung jedes gewerteten Laufs.

Ein Lauf ohne korrekte Entitäten und Artefakte ist kein langsamer Erfolg,
sondern ein Funktionsfehler. Bei einem Variationskoeffizienten über zehn
Prozent wird kein Speed-Sieger bestimmt. Eine Architekturentscheidung nennt
immer die fachlichen Gates vor den Messwerten.

## 12. Testvertrag für jeden CAD-Adapter

| Testklasse | Pflichtbeleg |
|---|---|
| Schema und Manifest | Capability-Manifest und Receipts validieren gegen das versionierte JSON-Schema |
| Contract Tests | Fake- und Realadapter erfüllen dieselbe Connector-Interface und dieselben Fehlercodes |
| Golden Fixtures | Part, komplexes Part, flache Assembly, verschachtelte Assembly, große Assembly und Negativfixture |
| Startmodusmatrix | jede behauptete Route je Startmodus; Add-in-Load nicht aus anderem Modus ableiten |
| Route Parity | Primär- und Fallbackroute liefern innerhalb deklarierter Grenzen dasselbe kanonische Ergebnis |
| BOM | Menge, Einheiten, Suppression, IncludeInBom, Reference-only, Unterbaugruppen und Konfiguration |
| Artefakte | Signatur, Parse/Render, Größe, Hash, Root-Referenzen und fehlende Ausgaben |
| Konsistenz | Save-State, Source Revision vor/nach Capture, Dateisperren und parallele Änderungen |
| Failure Injection | Busy/Timeout, Prozessende, Lizenzdialog, fehlende Referenz, ungültiger Export und Disk Full |
| Writes | Preview, Human Gate, Expected Version, idempotenter Retry, Read-back und Rollback |
| Security | Secret-Redaction, Pfadgrenzen, Signaturen, Allowlist und keine freie Shell-Ausführung |
| Lifecycle | Install, Update, Repair, Uninstall und Wiederherstellung einer bekannten Baseline |
| Performance | Rohdaten je Route, Fixture und Startmodus; keine manuell übertragenen Einzelzeiten |

Das JSON-Schema prüft Form, Enums, Pflichtfelder und lokale Sicherheitsregeln.
Ein zusätzlicher semantischer Validator muss eindeutige IDs, auflösbare
Route-/Capability-/Profilreferenzen, identische Environment-Fingerprints,
`p50 <= p95 <= max`, erlaubte Qualitätsübergänge sowie die vollständige
Anwendung der Fail-closed-Registry prüfen. Ein syntaktisch gültiges Manifest
ist allein noch kein Freigabebeleg.

## 13. Fail-closed-Regeln

| Code | Bedingung | Reaktion |
|---|---|---|
| `CAD-FC-001` | Capability ist `unknown`, `declared` oder `unsupported`, aber im Profil erforderlich | Capture/Write ablehnen |
| `CAD-FC-002` | gewählte Route ist für Produktbuild, Plattform oder Startmodus nicht verifiziert | Route nicht ausführen |
| `CAD-FC-003` | Fallback ist nicht vorab deklariert oder liefert geringere Qualität als erlaubt | kein Fallback; Fehler mit ursprünglicher Correlation-ID |
| `CAD-FC-004` | ungesicherter Editorstand wurde verlangt, ist aber nicht nachweisbar enthalten | Capture ablehnen; niemals disk-backed als vollständig melden |
| `CAD-FC-005` | Quellrevision oder Save-State ändert sich während des Captures | Staging verwerfen und neuen Capture verlangen |
| `CAD-FC-006` | Assemblyreferenz fehlt, Zyklus erkannt oder Traversierung unvollständig | Struktur und BOM nicht als vollständig veröffentlichen |
| `CAD-FC-007` | BOM-Mengen, Identitäten, Einheiten oder Konfiguration sind widersprüchlich | BOM-Profil ablehnen |
| `CAD-FC-008` | Pflichtartefakt fehlt, hat falsche Signatur, ist nicht parse-/renderbar oder Hash stimmt nicht | gesamtes Profil ablehnen und Partial-Staging löschen |
| `CAD-FC-009` | unbekannte native Dateiversion soll geschrieben werden | Write ablehnen; read-only Discovery bleibt möglich |
| `CAD-FC-010` | UI-Automation soll autoritative Daten lesen oder ein fachliches Write ersetzen | Operation ablehnen |
| `CAD-FC-011` | WritePlan, User Authority, erwartete Revision oder Capability-Grant fehlt | kein Write |
| `CAD-FC-012` | nativer Read-back stimmt nicht mit dem autorisierten Plan überein | Ergebnis `failed`, Rollback/Recovery starten |
| `CAD-FC-013` | Secret oder unredigierter sensitiver Pfad erscheint in Evidence | Evidence verwerfen und Security-Finding öffnen |
| `CAD-FC-014` | Lizenz-, Modal- oder Busy-Zustand verhindert eine definierte Antwort | Timeout klassifizieren; keinen Erfolg aus Prozesslebendigkeit ableiten |

Fehlercodes sind stabil, maschinenlesbar und werden zusammen mit
`correlation_id`, `route_id`, Startmodus und Retry-Klasse protokolliert.

## 14. Vorgehen für ein weiteres CAD-System

1. **Scope pinnen:** Hersteller, Produkt, Module, Build, Lizenz, OS,
   Architektur und ein benannter Workflow werden festgelegt.
2. **Startwege inventarisieren:** normaler Start, Dateidoppelklick, Attach,
   Automation, Batch, Server und Safe Mode werden separat erfasst.
3. **API-Routen inventarisieren:** Add-in/SDK, Live-Automation, CLI,
   Server-API, native Dateien, Exchange-Formate und UI-Automation werden ohne
   Reifegradannahme als `unknown` angelegt.
4. **Capability-Manifest erstellen:** jede Behauptung erhält Produktbuild,
   Startmodus, Route, Qualität, Caveat und Evidenzreferenz.
5. **Golden Fixtures importieren:** mindestens Part, komplexes Part, flache und
   verschachtelte Assembly sowie Negativfixture.
6. **Primärroute implementieren:** höchste fachliche Treue zuerst; Vendorwissen
   bleibt im Adapter.
7. **Fallback nur bei echtem Bedarf implementieren:** gleicher Vertrag,
   deklarierte Qualitätsgrenze und Route-Parity-Test.
8. **Capture fail-closed schließen:** Revision, Vollständigkeit, Artefakte,
   Hashes und Provenienz werden vor Veröffentlichung geprüft.
9. **Performance messen:** erst nach funktionaler Parität; Rohdaten werden mit
   der Capability-Evidenz versioniert.
10. **Writes separat freigeben:** Plan, Preview, Human Gate, Expected Version,
    Read-back und Rollback sind Pflicht.
11. **Kompatibilitätsmatrix veröffentlichen:** Ungetestete Kombinationen bleiben
    `unknown`; ein Demoerfolg ist keine Hersteller-Supportaussage.
12. **Release reviewen:** Product, Architecture, Operations und Security
    akzeptieren Capability-Gaps, Testbelege und Recovery.

## 15. Abnahmekriterien für einen produktiven Adapter

Ein Adapter darf nur dann als `verified` beziehungsweise produktionsbereit
geführt werden, wenn:

- sein Manifest gegen das V1-Schema validiert,
- mindestens ein Primärweg und ein echter Testadapter dieselbe Interface erfüllen,
- alle erforderlichen Capabilities in jeder freigegebenen Matrixzelle belegt sind,
- Startmodus- und Add-in-Verhalten nicht nur angenommen, sondern ausgeführt wurde,
- kanonische Identitäten, Occurrences, BOM und Properties Golden-Fixtures bestehen,
- Provenienz und Qualität auf Wert- und Artefaktebene vollständig sind,
- Pflichtartefakte semantisch und kryptografisch validiert werden,
- Performance-Rohdaten und keine bloßen Einzelmessungen vorliegen,
- negative, Recovery-, Install-, Update- und Uninstall-Tests bestehen,
- jeder Write Preview, separate Autorisierung, Read-back und Rollback besitzt,
- Secrets und personenbezogene Daten aus Logs und Evidence redigiert sind,
- offene Capability-Gaps im Produkt sichtbar und nicht durch Defaultwerte verdeckt sind.
