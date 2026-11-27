#!/usr/bin/env python3
"""Validiert alle 50 Lerneinheiten (Struktur, Quellen, Quiz-IDs, Qualität) und erzeugt src/data/units/index.ts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SPECS_PATH = ROOT / "scripts" / "unit_specs.json"
UNITS_DIR = ROOT / "src" / "data" / "units"
INDEX_PATH = UNITS_DIR / "index.ts"

VALID_VISUAL_KINDS = {
    "concept_map",
    "process_flow",
    "timeline",
    "comparison",
    "pyramid",
    "spectrum",
    "feature_grid",
    "dialogue",
}
VALID_QUALITIES = {"optimal", "teilweise", "problematisch"}
VALID_QTYPES = {"single", "multi", "case"}
VALID_DIFF = {"basis", "vertiefung", "pruefung"}
VALID_YEARS = {"1. Jahr", "2./3. Jahr", "1.–3. Jahr"}
VALID_ROLES = {"core", "orientation"}
VALID_TAGS = {
    "Partizipation",
    "Inklusion",
    "Prävention",
    "Sprachbildung",
    "Übergänge",
    "Wertevermittlung",
    "Digitale Welt",
    "BNE",
}

QUIZ_ID_RE = re.compile(r"^v2-q[1-9]\d*$")

META_TRIVIA_PATTERNS = [
    (re.compile(r"\bFußnote\s*\d+\b", re.IGNORECASE), "Fußnoten-Abfrage"),
    (re.compile(r"\bFn\.\s*\d+\b", re.IGNORECASE), "Fußnoten-Abfrage"),
    (re.compile(r"\bPDF-?Seiten?\b", re.IGNORECASE), "PDF-Seiten-Abfrage"),
    (re.compile(r"\bSeitenzahl(en)?\s+(im|des)\s+Lehrplans?\b", re.IGNORECASE), "Lehrplan-Seitenzahlen"),
    (re.compile(r"\bWie\s+viele\s+(Pflicht-?|Unterrichts-?)?Stunden\b", re.IGNORECASE), "Unterrichtsstunden-Abfrage"),
    (re.compile(r"\bTeilungsstunden\b", re.IGNORECASE), "Teilungsstunden-Trivia"),
    (re.compile(r"\bLernbaustein\s*\d+\b", re.IGNORECASE), "FHR-Lernbaustein-Trivia"),
    (
        re.compile(r"\bStundentafel\b.*\b(2\.?400|1\.?800|800|480|360|240)\b", re.IGNORECASE),
        "Stundentafel-Zahlenabfrage",
    ),
    (
        re.compile(r"\bWie\s+viele\s+schriftliche\s+Prüfungsmodule\b", re.IGNORECASE),
        "Prüfungsmodul-Anzahl-Abfrage",
    ),
]


def is_valid_https_url(raw: object) -> bool:
    if not isinstance(raw, str):
        return False
    url = raw.strip()
    if not url.startswith("https://") or any(ch.isspace() for ch in url):
        return False
    parsed = urlparse(url)
    return parsed.scheme == "https" and bool(parsed.netloc) and "." in parsed.netloc


def check_meta_trivia(unit_id: str, field_label: str, text: str, errors: list[str]) -> None:
    for pattern, reason in META_TRIVIA_PATTERNS:
        if pattern.search(text):
            errors.append(
                f"{unit_id}: {field_label} enthält unerwünschte Lehrplan-Meta-Abfrage ({reason})"
            )
            return


def validate_unit(spec: dict, path: Path) -> tuple[list[str], dict | None]:
    errors: list[str] = []
    uid = spec["id"]

    if not path.exists():
        return [f"Datei fehlt: {path}"], None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"Ungültiges JSON in {path.name}: {exc}"], None

    # Unveränderliche Strukturfelder gegen Spec prüfen
    if data.get("id") != uid:
        errors.append(f"{uid}: id mismatch ({data.get('id')})")
    if data.get("number") != spec["number"]:
        errors.append(f"{uid}: number mismatch ({data.get('number')} != {spec['number']})")
    if data.get("moduleCode") != spec["moduleCode"]:
        errors.append(
            f"{uid}: moduleCode mismatch ({data.get('moduleCode')} != {spec['moduleCode']})"
        )
    if data.get("moduleArea") != spec["moduleArea"]:
        errors.append(
            f"{uid}: moduleArea mismatch ({data.get('moduleArea')} != {spec['moduleArea']})"
        )
    if "bildungsbereich" in spec and data.get("bildungsbereich") != spec["bildungsbereich"]:
        errors.append(
            f"{uid}: bildungsbereich mismatch ({data.get('bildungsbereich')} != {spec['bildungsbereich']})"
        )

    for key in ("title", "subtitle", "hoursRef", "pdfPages"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            errors.append(f"{uid}: {key} fehlt oder ist leer")

    if data.get("year") not in VALID_YEARS:
        errors.append(f"{uid}: year ungültig ({data.get('year')})")

    if not isinstance(data.get("estimatedMinutes"), int) or data["estimatedMinutes"] <= 0:
        errors.append(f"{uid}: estimatedMinutes ungültig ({data.get('estimatedMinutes')})")

    unit_role = data.get("unitRole")
    if unit_role is not None:
        if unit_role not in VALID_ROLES:
            errors.append(f"{uid}: unitRole ungültig ({unit_role})")
        elif spec["moduleCode"] == "LEITLINIEN" and unit_role != "orientation":
            errors.append(f"{uid}: LEITLINIEN-Einheit sollte unitRole='orientation' haben")
        elif spec["moduleCode"] != "LEITLINIEN" and unit_role != "core":
            errors.append(f"{uid}: Fachmodul-Einheit sollte unitRole='core' haben")

    curriculum_ref = data.get("curriculumRef")
    if curriculum_ref is not None and (
        not isinstance(curriculum_ref, str) or not curriculum_ref.strip()
    ):
        errors.append(f"{uid}: curriculumRef darf nicht leer sein, wenn angegeben")

    tags = data.get("crossCuttingTags", [])
    if not isinstance(tags, list) or not tags:
        errors.append(f"{uid}: crossCuttingTags fehlt oder ist leer")
    else:
        invalid_tags = [t for t in tags if t not in VALID_TAGS]
        if invalid_tags:
            errors.append(f"{uid}: ungültige crossCuttingTags: {invalid_tags}")

    if not isinstance(data.get("summary"), str) or len(data["summary"].strip()) < 20:
        errors.append(f"{uid}: summary zu kurz oder fehlt")

    # Fachquellen (sources) prüfen
    sources = data.get("sources")
    if not isinstance(sources, list) or len(sources) < 2:
        count = len(sources) if isinstance(sources, list) else 0
        errors.append(f"{uid}: sources < 2 ({count})")
    else:
        seen_urls: set[str] = set()
        for i, src in enumerate(sources):
            if not isinstance(src, dict):
                errors.append(f"{uid}: sources[{i}] ist kein Objekt")
                continue
            title = src.get("title")
            url = src.get("url")
            if not isinstance(title, str) or len(title.strip()) < 3:
                errors.append(f"{uid}: sources[{i}].title fehlt oder zu kurz")
            if not is_valid_https_url(url):
                errors.append(f"{uid}: sources[{i}].url keine valide https://-URL ({url!r})")
            else:
                norm_url = url.strip()
                if norm_url in seen_urls:
                    errors.append(f"{uid}: sources[{i}].url doppelt ({norm_url})")
                seen_urls.add(norm_url)
            for opt_key in ("publisher", "note"):
                if opt_key in src and src[opt_key] is not None:
                    if not isinstance(src[opt_key], str) or not src[opt_key].strip():
                        errors.append(f"{uid}: sources[{i}].{opt_key} muss nicht-leerer String sein")

    goals = data.get("learningGoals", [])
    if not isinstance(goals, list) or len(goals) < 3:
        errors.append(f"{uid}: zu wenige learningGoals ({len(goals) if isinstance(goals, list) else 0})")
    else:
        for i, goal in enumerate(goals):
            if not isinstance(goal, str) or len(goal.strip()) < 10:
                errors.append(f"{uid}: learningGoals[{i}] leer oder zu kurz")
            else:
                check_meta_trivia(uid, f"learningGoals[{i}]", goal, errors)

    sections = data.get("sections", [])
    if not isinstance(sections, list) or len(sections) < 3:
        errors.append(f"{uid}: zu wenige sections ({len(sections) if isinstance(sections, list) else 0})")
    else:
        for i, sec in enumerate(sections):
            for key in ("heading", "keyTakeaway", "body", "praxisTip"):
                if not isinstance(sec.get(key), str) or not sec[key].strip():
                    errors.append(f"{uid}: section[{i}].{key} leer")
            if not isinstance(sec.get("bulletPoints"), list) or len(sec["bulletPoints"]) < 2:
                errors.append(f"{uid}: section[{i}].bulletPoints zu kurz")

    visuals = data.get("visualBlocks", [])
    if not isinstance(visuals, list) or len(visuals) < 3:
        errors.append(f"{uid}: visualBlocks < 3 ({len(visuals) if isinstance(visuals, list) else 0})")
    else:
        for i, vb in enumerate(visuals):
            if vb.get("kind") not in VALID_VISUAL_KINDS:
                errors.append(f"{uid}: visualBlocks[{i}].kind ungültig ({vb.get('kind')})")
            for key in ("id", "title", "subtitle"):
                if not isinstance(vb.get(key), str) or not vb[key].strip():
                    errors.append(f"{uid}: visualBlocks[{i}].{key} leer")
            items = vb.get("items", [])
            if not isinstance(items, list) or len(items) < 3:
                errors.append(f"{uid}: visualBlocks[{i}].items < 3 ({len(items) if isinstance(items, list) else 0})")
            else:
                for j, it in enumerate(items):
                    for key in ("id", "label", "summary", "detail"):
                        if not isinstance(it.get(key), str) or not it[key].strip():
                            errors.append(f"{uid}: visualBlocks[{i}].items[{j}].{key} leer")

    cs = data.get("caseStudy", {})
    if not isinstance(cs, dict):
        errors.append(f"{uid}: caseStudy fehlt")
    else:
        for key in ("title", "setting", "ageGroup", "context"):
            if not isinstance(cs.get(key), str) or not cs[key].strip():
                errors.append(f"{uid}: caseStudy.{key} leer")
        steps = cs.get("steps", [])
        if not isinstance(steps, list) or len(steps) < 2:
            errors.append(f"{uid}: caseStudy.steps < 2 ({len(steps) if isinstance(steps, list) else 0})")
        else:
            for i, st in enumerate(steps):
                for key in ("situation", "prompt"):
                    if not isinstance(st.get(key), str) or not st[key].strip():
                        errors.append(f"{uid}: caseStudy.steps[{i}].{key} leer")
                opts = st.get("options", [])
                if not isinstance(opts, list) or len(opts) != 3:
                    errors.append(
                        f"{uid}: caseStudy.steps[{i}].options != 3 ({len(opts) if isinstance(opts, list) else 0})"
                    )
                    continue
                qualities = [o.get("quality") for o in opts]
                if any(q not in VALID_QUALITIES for q in qualities):
                    errors.append(f"{uid}: caseStudy.steps[{i}] ungültige quality: {qualities}")
                if "optimal" not in qualities:
                    errors.append(f"{uid}: caseStudy.steps[{i}] ohne 'optimal'-Option")
                for j, opt in enumerate(opts):
                    for key in ("label", "feedback", "theoryLink"):
                        if not isinstance(opt.get(key), str) or not opt[key].strip():
                            errors.append(f"{uid}: caseStudy.steps[{i}].options[{j}].{key} leer")

    tasks = data.get("selfLearningTasks", [])
    if not isinstance(tasks, list) or len(tasks) < 2:
        errors.append(f"{uid}: selfLearningTasks < 2")
    else:
        for i, task in enumerate(tasks):
            if not isinstance(task, str) or len(task.strip()) < 10:
                errors.append(f"{uid}: selfLearningTasks[{i}] leer oder zu kurz")

    cards = data.get("flashcards", [])
    if not isinstance(cards, list) or len(cards) < 5:
        errors.append(f"{uid}: flashcards < 5 ({len(cards) if isinstance(cards, list) else 0})")
    else:
        for i, card in enumerate(cards):
            for key in ("term", "definition", "example"):
                if not isinstance(card.get(key), str) or not card[key].strip():
                    errors.append(f"{uid}: flashcards[{i}].{key} leer")
            combined = f"{card.get('term', '')} {card.get('definition', '')}"
            check_meta_trivia(uid, f"flashcards[{i}]", combined, errors)

    quiz = data.get("quiz", [])
    if not isinstance(quiz, list) or len(quiz) < 6:
        errors.append(f"{uid}: quiz < 6 ({len(quiz) if isinstance(quiz, list) else 0})")
    else:
        seen_qids: set[str] = set()
        for i, q in enumerate(quiz):
            qid = q.get("id")
            if not isinstance(qid, str) or not QUIZ_ID_RE.match(qid):
                errors.append(
                    f"{uid}: quiz[{i}].id ungültig ({qid!r}, erwartet Schema v2-q1, v2-q2, ...)"
                )
            elif qid in seen_qids:
                errors.append(f"{uid}: quiz[{i}].id doppelt ({qid})")
            else:
                seen_qids.add(qid)

            if q.get("type") not in VALID_QTYPES:
                errors.append(f"{uid}: quiz[{i}].type ungültig ({q.get('type')})")
            if q.get("difficulty") not in VALID_DIFF:
                errors.append(f"{uid}: quiz[{i}].difficulty ungültig ({q.get('difficulty')})")
            if not isinstance(q.get("question"), str) or len(q["question"].strip()) < 10:
                errors.append(f"{uid}: quiz[{i}].question leer oder zu kurz")
            if not isinstance(q.get("explanation"), str) or len(q["explanation"].strip()) < 15:
                errors.append(f"{uid}: quiz[{i}].explanation leer oder zu kurz")

            opts = q.get("options", [])
            if not isinstance(opts, list) or len(opts) != 4:
                errors.append(f"{uid}: quiz[{i}].options != 4 ({len(opts) if isinstance(opts, list) else 0})")
            else:
                cleaned_opts = [o.strip() for o in opts if isinstance(o, str) and o.strip()]
                if len(cleaned_opts) != 4:
                    errors.append(f"{uid}: quiz[{i}].options enthält leere Einträge")
                elif len(set(cleaned_opts)) != 4:
                    errors.append(f"{uid}: quiz[{i}].options enthält Duplikate")

            idxs = q.get("correctIndices", [])
            if not isinstance(idxs, list) or not idxs:
                errors.append(f"{uid}: quiz[{i}].correctIndices leer")
            elif any((not isinstance(ix, int) or isinstance(ix, bool) or ix < 0 or ix >= 4) for ix in idxs):
                errors.append(f"{uid}: quiz[{i}].correctIndices außerhalb 0..3: {idxs}")
            elif len(set(idxs)) != len(idxs):
                errors.append(f"{uid}: quiz[{i}].correctIndices enthält Duplikate: {idxs}")
            elif q.get("type") in ("single", "case") and len(idxs) != 1:
                errors.append(
                    f"{uid}: quiz[{i}] ({q.get('type')}) hat {len(idxs)} Indizes statt 1"
                )
            elif q.get("type") == "multi" and len(idxs) < 2:
                errors.append(f"{uid}: quiz[{i}] (multi) braucht mind. 2 correctIndices")

            q_text = " ".join(
                str(part)
                for part in (
                    q.get("question", ""),
                    q.get("explanation", ""),
                    *(opts if isinstance(opts, list) else []),
                )
            )
            check_meta_trivia(uid, f"quiz[{i}] ({qid})", q_text, errors)

    return errors, data


def generate_index_ts(specs: list[dict]) -> None:
    lines = [
        "import { LearningUnit } from '../../types/curriculum';",
        "",
    ]
    var_names = []
    for spec in sorted(specs, key=lambda x: x["number"]):
        var_name = f"unit{spec['number']:02d}"
        var_names.append(var_name)
        lines.append(f"import {var_name} from './{spec['id']}.json';")

    lines.append("")
    lines.append("export const ALL_UNITS: LearningUnit[] = [")
    for var_name in var_names:
        lines.append(f"  {var_name} as unknown as LearningUnit,")
    lines.append("];")
    lines.append("")
    lines.append(
        "export const UNITS_BY_ID: Record<string, LearningUnit> = Object.fromEntries("
    )
    lines.append("  ALL_UNITS.map((unit) => [unit.id, unit])")
    lines.append(");")
    lines.append("")
    lines.append("export const ALL_FLASHCARDS = ALL_UNITS.flatMap((unit) =>")
    lines.append("  unit.flashcards.map((card, cardIndex) => ({")
    lines.append("    ...card,")
    lines.append("    unitId: unit.id,")
    lines.append("    unitNumber: unit.number,")
    lines.append("    unitTitle: unit.title,")
    lines.append("    moduleCode: unit.moduleCode,")
    lines.append("    cardIndex,")
    lines.append("  }))")
    lines.append(");")
    lines.append("")

    INDEX_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validiert Lerneinheiten und aktualisiert src/data/units/index.ts."
    )
    parser.add_argument(
        "--unit",
        action="append",
        dest="units",
        help="Nur bestimmte Einheiten-ID(s) oder Nummern (z. B. 15 oder 15-sp2-...) prüfen.",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Nur prüfen, ohne src/data/units/index.ts neu zu schreiben.",
    )
    args = parser.parse_args()

    specs = json.loads(SPECS_PATH.read_text(encoding="utf-8"))
    selected_specs = sorted(specs, key=lambda x: x["number"])

    if args.units:
        wanted = set(args.units)
        selected_specs = [
            s
            for s in selected_specs
            if s["id"] in wanted
            or str(s["number"]) in wanted
            or f"{s['number']:02d}" in wanted
        ]
        if not selected_specs:
            print(f"FEHLER: Keine passende Einheit für --unit={args.units} gefunden.")
            sys.exit(1)

    all_errors: list[str] = []
    total_visuals = 0
    total_case_steps = 0
    total_cards = 0
    total_quiz = 0
    total_sources = 0

    for spec in selected_specs:
        unit_path = UNITS_DIR / f"{spec['id']}.json"
        errs, data = validate_unit(spec, unit_path)
        all_errors.extend(errs)
        if data:
            total_visuals += len(data.get("visualBlocks", []))
            total_case_steps += len(data.get("caseStudy", {}).get("steps", []))
            total_cards += len(data.get("flashcards", []))
            total_quiz += len(data.get("quiz", []))
            total_sources += len(data.get("sources", []) or [])

    if all_errors:
        print(f"FEHLER ({len(all_errors)}):")
        for err in all_errors[:80]:
            print(" -", err)
        if len(all_errors) > 80:
            print(f" ... und {len(all_errors) - 80} weitere Fehler.")
        sys.exit(1)

    if not args.check_only and not args.units:
        generate_index_ts(specs)
        print(f"Index geschrieben nach {INDEX_PATH}")

    print(f"OK: {len(selected_specs)}/{len(selected_specs)} units validated")
    print(
        f"Statistik: {total_visuals} VisualBlocks | {total_case_steps} CaseStudy-Steps | "
        f"{total_cards} Flashcards | {total_quiz} Quiz-Fragen | {total_sources} Fachquellen"
    )


if __name__ == "__main__":
    main()
