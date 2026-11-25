#!/usr/bin/env python3
"""Validiert alle 50 Lerneinheiten und erzeugt src/data/units/index.ts."""

import json
import sys
from pathlib import Path

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


def validate_unit(spec: dict, path: Path) -> tuple[list[str], dict | None]:
    errors: list[str] = []
    if not path.exists():
        return [f"Datei fehlt: {path}"], None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"Ungültiges JSON in {path.name}: {exc}"], None

    if data.get("id") != spec["id"]:
        errors.append(f"{spec['id']}: id mismatch ({data.get('id')})")
    if not isinstance(data.get("summary"), str) or len(data["summary"].strip()) < 20:
        errors.append(f"{spec['id']}: summary zu kurz oder fehlt")

    goals = data.get("learningGoals", [])
    if not isinstance(goals, list) or len(goals) < 3:
        errors.append(f"{spec['id']}: zu wenige learningGoals ({len(goals)})")

    sections = data.get("sections", [])
    if not isinstance(sections, list) or len(sections) < 3:
        errors.append(f"{spec['id']}: zu wenige sections ({len(sections)})")
    else:
        for i, sec in enumerate(sections):
            for key in ("heading", "keyTakeaway", "body", "praxisTip"):
                if not isinstance(sec.get(key), str) or not sec[key].strip():
                    errors.append(f"{spec['id']}: section[{i}].{key} leer")
            if not isinstance(sec.get("bulletPoints"), list) or len(sec["bulletPoints"]) < 2:
                errors.append(f"{spec['id']}: section[{i}].bulletPoints zu kurz")

    visuals = data.get("visualBlocks", [])
    if not isinstance(visuals, list) or len(visuals) < 3:
        errors.append(f"{spec['id']}: visualBlocks < 3 ({len(visuals)})")
    else:
        for i, vb in enumerate(visuals):
            if vb.get("kind") not in VALID_VISUAL_KINDS:
                errors.append(f"{spec['id']}: visualBlocks[{i}].kind ungültig ({vb.get('kind')})")
            items = vb.get("items", [])
            if not isinstance(items, list) or len(items) < 3:
                errors.append(f"{spec['id']}: visualBlocks[{i}].items < 3 ({len(items)})")
            for j, it in enumerate(items):
                for key in ("id", "label", "summary", "detail"):
                    if not isinstance(it.get(key), str) or not it[key].strip():
                        errors.append(f"{spec['id']}: visualBlocks[{i}].items[{j}].{key} leer")

    cs = data.get("caseStudy", {})
    steps = cs.get("steps", [])
    if not isinstance(steps, list) or len(steps) < 2:
        errors.append(f"{spec['id']}: caseStudy.steps < 2 ({len(steps)})")
    else:
        for i, st in enumerate(steps):
            opts = st.get("options", [])
            if len(opts) != 3:
                errors.append(f"{spec['id']}: caseStudy.steps[{i}].options != 3 ({len(opts)})")
            qualities = [o.get("quality") for o in opts]
            if any(q not in VALID_QUALITIES for q in qualities):
                errors.append(f"{spec['id']}: caseStudy.steps[{i}] ungültige quality: {qualities}")
            if "optimal" not in qualities:
                errors.append(f"{spec['id']}: caseStudy.steps[{i}] ohne 'optimal'-Option")

    tasks = data.get("selfLearningTasks", [])
    if not isinstance(tasks, list) or len(tasks) < 2:
        errors.append(f"{spec['id']}: selfLearningTasks < 2")

    cards = data.get("flashcards", [])
    if not isinstance(cards, list) or len(cards) < 4:
        errors.append(f"{spec['id']}: flashcards < 4 ({len(cards)})")

    quiz = data.get("quiz", [])
    if not isinstance(quiz, list) or len(quiz) < 5:
        errors.append(f"{spec['id']}: quiz < 5 ({len(quiz)})")
    else:
        for i, q in enumerate(quiz):
            if q.get("type") not in VALID_QTYPES:
                errors.append(f"{spec['id']}: quiz[{i}].type ungültig ({q.get('type')})")
            if q.get("difficulty") not in VALID_DIFF:
                errors.append(f"{spec['id']}: quiz[{i}].difficulty ungültig ({q.get('difficulty')})")
            opts = q.get("options", [])
            if len(opts) != 4:
                errors.append(f"{spec['id']}: quiz[{i}].options != 4 ({len(opts)})")
            idxs = q.get("correctIndices", [])
            if not isinstance(idxs, list) or not idxs:
                errors.append(f"{spec['id']}: quiz[{i}].correctIndices leer")
            elif any((not isinstance(ix, int) or ix < 0 or ix >= 4) for ix in idxs):
                errors.append(f"{spec['id']}: quiz[{i}].correctIndices außerhalb 0..3: {idxs}")
            elif q.get("type") in ("single", "case") and len(idxs) != 1:
                errors.append(f"{spec['id']}: quiz[{i}] ({q.get('type')}) hat {len(idxs)} Indizes statt 1")

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
    specs = json.loads(SPECS_PATH.read_text(encoding="utf-8"))
    all_errors: list[str] = []
    total_visuals = 0
    total_case_steps = 0
    total_cards = 0
    total_quiz = 0

    for spec in sorted(specs, key=lambda x: x["number"]):
        unit_path = UNITS_DIR / f"{spec['id']}.json"
        errs, data = validate_unit(spec, unit_path)
        all_errors.extend(errs)
        if data:
            total_visuals += len(data.get("visualBlocks", []))
            total_case_steps += len(data.get("caseStudy", {}).get("steps", []))
            total_cards += len(data.get("flashcards", []))
            total_quiz += len(data.get("quiz", []))

    if all_errors:
        print(f"FEHLER ({len(all_errors)}):")
        for err in all_errors[:60]:
            print(" -", err)
        sys.exit(1)

    generate_index_ts(specs)
    print(f"OK: {len(specs)}/{len(specs)} units validated")
    print(
        f"Statistik: {total_visuals} VisualBlocks | {total_case_steps} CaseStudy-Steps | "
        f"{total_cards} Flashcards | {total_quiz} Quiz-Fragen"
    )
    print(f"Index geschrieben nach {INDEX_PATH}")


if __name__ == "__main__":
    main()
