#!/usr/bin/env python3
"""Run-Workflow-Skript: 50 Hydrogen-Subagenten (5 Wellen à 10) generieren alle 50 Lerneinheiten."""

import json
from pathlib import Path

ROOT = Path.cwd()
SPECS_PATH = ROOT / "scripts" / "unit_specs.json"
UNITS_DIR = ROOT / "src" / "data" / "units"
UNITS_DIR.mkdir(parents=True, exist_ok=True)

UNIT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "learningGoals": {
            "type": "array",
            "items": {"type": "string"},
        },
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "keyTakeaway": {"type": "string"},
                    "body": {"type": "string"},
                    "bulletPoints": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "praxisTip": {"type": "string"},
                },
                "required": ["heading", "keyTakeaway", "body", "bulletPoints", "praxisTip"],
            },
        },
        "visualBlocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": [
                            "concept_map",
                            "process_flow",
                            "timeline",
                            "comparison",
                            "pyramid",
                            "spectrum",
                            "feature_grid",
                            "dialogue",
                        ],
                    },
                    "title": {"type": "string"},
                    "subtitle": {"type": "string"},
                    "centerLabel": {"type": "string"},
                    "leftPole": {"type": "string"},
                    "rightPole": {"type": "string"},
                    "isCycle": {"type": "boolean"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "badge": {"type": "string"},
                                "summary": {"type": "string"},
                                "detail": {"type": "string"},
                                "example": {"type": "string"},
                                "metric": {"type": "string"},
                            },
                            "required": ["id", "label", "badge", "summary", "detail", "example", "metric"],
                        },
                    },
                },
                "required": [
                    "id",
                    "kind",
                    "title",
                    "subtitle",
                    "centerLabel",
                    "leftPole",
                    "rightPole",
                    "isCycle",
                    "items",
                ],
            },
        },
        "caseStudy": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "setting": {"type": "string"},
                "ageGroup": {"type": "string"},
                "context": {"type": "string"},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "situation": {"type": "string"},
                            "prompt": {"type": "string"},
                            "options": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "quality": {
                                            "type": "string",
                                            "enum": ["optimal", "teilweise", "problematisch"],
                                        },
                                        "feedback": {"type": "string"},
                                        "theoryLink": {"type": "string"},
                                    },
                                    "required": ["label", "quality", "feedback", "theoryLink"],
                                },
                            },
                        },
                        "required": ["situation", "prompt", "options"],
                    },
                },
            },
            "required": ["title", "setting", "ageGroup", "context", "steps"],
        },
        "selfLearningTasks": {
            "type": "array",
            "items": {"type": "string"},
        },
        "flashcards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "term": {"type": "string"},
                    "definition": {"type": "string"},
                    "example": {"type": "string"},
                },
                "required": ["term", "definition", "example"],
            },
        },
        "quiz": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": ["single", "multi", "case"]},
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "correctIndices": {"type": "array", "items": {"type": "integer"}},
                    "explanation": {"type": "string"},
                    "difficulty": {
                        "type": "string",
                        "enum": ["basis", "vertiefung", "pruefung"],
                    },
                },
                "required": [
                    "id",
                    "type",
                    "question",
                    "options",
                    "correctIndices",
                    "explanation",
                    "difficulty",
                ],
            },
        },
    },
    "required": [
        "summary",
        "learningGoals",
        "sections",
        "visualBlocks",
        "caseStudy",
        "selfLearningTasks",
        "flashcards",
        "quiz",
    ],
}


def is_valid_existing_unit(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if len(data.get("visualBlocks", [])) < 3:
            return False
        for vb in data["visualBlocks"]:
            if len(vb.get("items", [])) < 3:
                return False
        if len(data.get("sections", [])) < 3:
            return False
        if len(data.get("flashcards", [])) < 4:
            return False
        if len(data.get("quiz", [])) < 5:
            return False
        if len(data.get("caseStudy", {}).get("steps", [])) < 2:
            return False
        for q in data["quiz"]:
            opts = q.get("options", [])
            idxs = q.get("correctIndices", [])
            if len(opts) != 4 or not idxs:
                return False
            if any((not isinstance(i, int) or i < 0 or i >= 4) for i in idxs):
                return False
        return True
    except Exception:
        return False


def build_prompt(spec: dict) -> str:
    vis_list = ", ".join(spec["requiredVisualTypes"])
    bb_line = f"Bildungsbereich: {spec['bildungsbereich']}\n" if spec.get("bildungsbereich") else ""
    return f"""Du bist Fachautor:in für Sozialpädagogik und entwickelst Einheit {spec['number']}/50 einer hochvisuellen, interaktiven Online-Lernplattform für die Fachschule Sozialwesen (Fachrichtung Sozialpädagogik, Lehrplan Rheinland-Pfalz vom 25.09.2024).

WICHTIGE ARBEITSREGEL:
Du hast alle benötigten Quellen direkt in diesem Prompt. Rufe KEINE Datei-, Such- oder Terminal-Tools auf! Liefere das vollständige, fachlich präzise, praxisnahe deutsche Ergebnis direkt über das `finish`-Tool.

METADATEN DER EINHEIT:
- ID: {spec['id']}
- Nummer: {spec['number']} von 50
- Modul: {spec['moduleCode']} ({spec['hoursRef']})
- {bb_line}Titel: {spec['title']}
- Untertitel: {spec['subtitle']}
- Ausbildungsjahr (BB-Zuordnung): {spec['year']}
- PDF-Seiten: {spec['pdfPages']}
- Querschnittsthemen: {', '.join(spec['crossCuttingTags'])}

INHALTLICHER SCHWERPUNKT:
{spec['focusGuidance']}

WÖRTLICHER LEHRPLAN-AUSZUG (RLP-PDF):
---
{spec['pdfExcerpt']}
---

QUALITÄTS- UND STRUKTURVORGABEN FÜR DEIN ERGEBNIS:
1. **summary**: 2–3 prägnante Sätze zum Kernnutzen dieser Einheit für angehende Erzieher:innen („Bachelor Professional in Sozialwesen“).
2. **learningGoals**: 4–6 konkrete „Ich kann …“-Kompetenzziele passend zum RLP-Lehrplan.
3. **sections**: 3–4 gut strukturierte Theorie-Blöcke (keine Textwüste!):
   - `heading`: aussagekräftige Überschrift
   - `keyTakeaway`: 1 knackiger Merksatz
   - `body`: 2–4 präzise Sätze auf Fachschul-Niveau mit konkreten Fachbegriffen, Modellen, Gesetzen (§§) oder Autor:innen (nur belegte Konzepte aus der Fachwissenschaft & dem Lehrplan)
   - `bulletPoints`: 3–5 stichhaltige Kernpunkte
   - `praxisTip`: 1 konkreter Umsetzungstipp für Kita, Hort, Ganztagsschule oder Kinder-/Jugendhilfe
4. **visualBlocks**: EXAKT 3 interaktive Visualisierungen mit exakt diesen 3 `kind`-Typen in dieser Reihenfolge: [{vis_list}].
   - Jeder Block braucht 4–5 aussagekräftige `items` (mit kurzer `id` wie "item-1", prägnantem `label`, passendem `badge` wie Zeitangabe/Stufe/Kriterium/Sprecher, `summary` in 1 Satz, `detail` in 2–3 Sätzen, konkretem `example` aus der sozialpädagogischen Praxis und kurzem `metric` wie "Stufe 1" oder "Kernprinzip").
   - Typ-spezifische Pflichtfelder sauber ausfüllen (bei nicht genutzten Feldern leeren String `""` bzw. `false` angeben):
     - `concept_map`: `centerLabel` = Kernbegriff im Zentrum.
     - `process_flow`: `isCycle` = `true` bei einem Kreislauf (z. B. Forschungskreis/PDCA), sonst `false`; Items sind geordnete Schritte.
     - `timeline`: Items sind chronologische Phasen/Altersstufen (`badge` = Zeitraum/Alter).
     - `comparison`: Items sind die verglichenen Ansätze/Konzepte/Modelle.
     - `pyramid`: Items von Fundament (Index 0) bis Spitze (letzter Index), `badge` = Ebene.
     - `spectrum`: `leftPole` = linker Extrempol, `rightPole` = rechter Extrempol; Items von links nach rechts geordnet (mittleres Item = professionelle Balance!).
     - `feature_grid`: Items sind zentrale Bausteine/Kriterien.
     - `dialogue`: Items sind Gesprächs-Perspektiven, Kommunikationsschritte oder 4-Ohren-/GFK-Ebenen (`badge` = Rolle/Ohr/Schritt, `example` = konkretes wörtliches Zitat).
5. **caseStudy**: 1 realistisches, zweistufiges Praxis-Fallbeispiel (`steps` = exakt 2 Schritte).
   - Jeder Schritt hat exakt 3 `options`: einmal `quality: "optimal"`, einmal `"teilweise"`, einmal `"problematisch"` (Reihenfolge gemischt!), jeweils mit fundiertem `feedback` und `theoryLink` (konkreter Theorie-/Gesetzes-/Lehrplanbezug).
6. **selfLearningTasks**: 2–3 konkrete Praxis-/Selbstlernaufgaben (angelehnt an „Anregungen für Selbstlernzeiten und die Theorie-/Praxis-Verzahnung“).
7. **flashcards**: 5–6 zentrale Fachbegriffe mit klarer `definition` und kurzem `example`.
8. **quiz**: 5–6 abwechslungsreiche Prüfungsfragen:
   - Mindestens 1 Frage mit `type: "multi"` (mehrere richtige Antworten!), mindestens 1 Frage mit `type: "case"` (kurze Praxissituation), restliche `"single"`.
   - Mix aus `difficulty`: `"basis"`, `"vertiefung"`, `"pruefung"`.
   - Jede Frage hat EXAKT 4 `options`.
   - WICHTIG: `correctIndices` muss **0-basierte Indizes (0, 1, 2 oder 3)** enthalten! Bei `"single"` und `"case"` exakt 1 Index; bei `"multi"` 2 oder 3 Indizes.
   - Jede Frage hat eine klare `explanation`, warum die richtige(n) Option(en) fachlich korrekt sind.
"""


def merge_unit(spec: dict, generated: dict) -> dict:
    unit = {
        "id": spec["id"],
        "number": spec["number"],
        "moduleCode": spec["moduleCode"],
        "moduleArea": spec["moduleArea"],
    }
    if spec.get("bildungsbereich"):
        unit["bildungsbereich"] = spec["bildungsbereich"]
    unit.update(
        {
            "title": spec["title"],
            "subtitle": spec["subtitle"],
            "year": spec["year"],
            "estimatedMinutes": spec["estimatedMinutes"],
            "hoursRef": spec["hoursRef"],
            "pdfPages": spec["pdfPages"],
            "crossCuttingTags": spec["crossCuttingTags"],
            "summary": generated["summary"],
            "learningGoals": generated["learningGoals"],
            "sections": generated["sections"],
            "visualBlocks": generated["visualBlocks"],
            "caseStudy": generated["caseStudy"],
            "selfLearningTasks": generated["selfLearningTasks"],
            "flashcards": generated["flashcards"],
            "quiz": generated["quiz"],
        }
    )
    return unit


async def run_wave(wave_idx: int, wave_specs: list[dict]) -> None:
    start_num = wave_specs[0]["number"]
    end_num = wave_specs[-1]["number"]
    phase(f"Welle {wave_idx}: Einheiten {start_num:02d}–{end_num:02d}")

    pending = []
    for s in wave_specs:
        target = UNITS_DIR / f"{s['id']}.json"
        if is_valid_existing_unit(target):
            log(f"Überspringe bereits gültige Einheit {s['number']:02d}: {s['id']}")
        else:
            pending.append(s)

    if not pending:
        log(f"Welle {wave_idx} komplett bereits vorhanden.")
        return

    log(f"Starte {len(pending)} Hydrogen-Subagenten in Welle {wave_idx}...")
    results = await parallel(
        pending,
        lambda s: agent(
            prompt=build_prompt(s),
            schema=UNIT_SCHEMA,
            role=f"E{s['number']:02d} {s['moduleCode']}: {s['title'][:26]}",
            type_name="self",
            model="flash_lite",
        ),
    )

    for spec, generated in zip(pending, results):
        unit = merge_unit(spec, generated)
        out_file = UNITS_DIR / f"{spec['id']}.json"
        out_file.write_text(json.dumps(unit, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Welle {wave_idx}: {len(pending)} Einheiten gespeichert.")


specs = json.loads(SPECS_PATH.read_text(encoding="utf-8"))
assert len(specs) == 50, f"Erwartet 50 Specs, gefunden {len(specs)}"

for w in range(5):
    chunk = specs[w * 10 : (w + 1) * 10]
    await run_wave(w + 1, chunk)

log("ALLE 50 EINHEITEN ERFOLGREICH GENERIERT!")
