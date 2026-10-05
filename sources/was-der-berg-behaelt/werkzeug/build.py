#!/usr/bin/env python3
"""Baut site/book.json aus kapitel/*.md (Minimal-Markdown für den Roman)."""
import html, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KAP = ROOT / "kapitel"
OUT = ROOT / "site" / "book.json"

PARTS = [
    {"n": 1, "title": "Was das Wasser will", "roman": "I", "image": "img/teil1-wasser.webp"},
    {"n": 2, "title": "Was der Baum will", "roman": "II", "image": "img/teil2-baum.webp"},
    {"n": 3, "title": "Was das Feuer will", "roman": "III", "image": "img/teil3-feuer.webp"},
]


def inline(s):
    s = html.escape(s, quote=False).replace("\\*", "&#42;")
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", r"<em>\1</em>", s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    return s


def blocks_to_html(lines):
    out, i = [], 0
    while i < len(lines):
        ln = lines[i].rstrip()
        st = ln.strip()
        if not st:
            i += 1
            continue
        if st in ("* * *", "***", "---", "* * * *"):
            out.append('<hr class="scene">')
            i += 1
            continue
        if st.startswith("### "):
            out.append(f"<h3>{inline(st[4:])}</h3>")
            i += 1
            continue
        if st.startswith("#### "):
            out.append(f"<h4>{inline(st[5:])}</h4>")
            i += 1
            continue
        if st.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            cells = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
            cells = [r for r in cells if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]
            if cells:
                h = "".join(f"<th>{inline(c)}</th>" for c in cells[0])
                b = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in cells[1:])
                out.append(f'<div class="tablewrap"><table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table></div>')
            continue
        if re.match(r"^[-*] ", st):
            items = []
            while i < len(lines) and re.match(r"^\s*[-*] ", lines[i]):
                items.append(re.sub(r"^\s*[-*] ", "", lines[i].strip()))
                i += 1
            out.append("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ul>")
            continue
        if re.match(r"^\d+\. ", st):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\. ", lines[i]):
                items.append(re.sub(r"^\s*\d+\. ", "", lines[i].strip()))
                i += 1
            out.append("<ol>" + "".join(f"<li>{inline(x)}</li>" for x in items) + "</ol>")
            continue
        if st.startswith(">"):
            q = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                t = lines[i].strip()[1:].strip()
                if t:
                    q.append(f"<p>{inline(t)}</p>")
                i += 1
            out.append("<blockquote>" + "".join(q) + "</blockquote>")
            continue
        # Romanprosa: jede Zeile ist ein Absatz
        out.append(f"<p>{inline(st)}</p>")
        i += 1
    return "\n".join(out)


def words(s):
    return len(re.findall(r"\w+", re.sub(r"<[^>]+>", " ", s)))


def parse_chapter(path):
    lines = path.read_text(encoding="utf-8").splitlines()
    part, title, head, body = None, None, None, []
    for ln in lines:
        st = ln.strip()
        m = re.match(r"^# Teil (I{1,3})\b", st)
        if m and title is None:
            part = {"I": 1, "II": 2, "III": 3}[m.group(1)]
            continue
        if st.startswith("## ") and title is None:
            title = st[3:].strip()
            continue
        if title is not None and head is None and not any(b.strip() for b in body) and re.fullmatch(r"\*[^*].*\*", st):
            head = st[1:-1]
            continue
        if title is not None:
            body.append(ln)
    return part, title, head, body


def split_anhang(path):
    """Teilt den Anhang an '## '-Überschriften in eigene Abschnitte."""
    secs, cur = [], None
    for ln in path.read_text(encoding="utf-8").splitlines():
        st = ln.strip()
        if st.startswith("# ") and not st.startswith("## "):
            continue
        if st.startswith("## "):
            cur = {"title": st[3:].strip(), "lines": []}
            secs.append(cur)
        elif cur is not None:
            cur["lines"].append(ln)
    return secs


def glossary_from(lines):
    gl = {}
    for ln in lines:
        st = ln.strip()
        m = re.match(r"^(?:[-*] )?(?:\*\*|\*|_)?\*?([^*_:–—]+?)\*?(?:\*\*|\*|_)?\s*(?:\([^)]*\))?\s*[:–—]\s+(.+)$", st)
        if not m:
            m2 = re.match(r"^\|\s*\*?([^|*]+?)\*?\s*\|\s*([^|]+)\|", st)
            if m2 and not set(m2.group(1)) <= set("-: "):
                m = m2
        if m:
            term = re.sub(r"[*_]", "", m.group(1)).strip()
            expl = re.sub(r"[*_]", "", m.group(2)).strip()
            if 1 <= len(term) <= 40 and term.lower() not in ("begriff", "monat", "name"):
                for t in re.split(r"\s*(?:,|/| oder )\s*", term):
                    if t:
                        gl[t.lower()] = expl
    return gl


def main():
    files = sorted(p for p in KAP.glob("*.md") if not p.name.startswith("99"))
    chapters, cur_part = [], 0
    for p in files:
        part, title, head, body = parse_chapter(p)
        if part:
            cur_part = part
        if not title:
            print("WARNUNG: kein Titel in", p.name, file=sys.stderr)
            continue
        kind = "prolog" if p.name.startswith("00") else "epilog" if "epilog" in p.name else "kapitel"
        m = re.match(r"(Kapitel\s+(\d+)|Prolog|Epilog)\s*[:–-]\s*(.+)", title)
        label, short = (title, title)
        if m:
            label = m.group(1)
            short = m.group(3).strip()
        cid = "prolog" if kind == "prolog" else "epilog" if kind == "epilog" else f"k{int(m.group(2)):02d}" if m and m.group(2) else p.stem
        h = blocks_to_html(body)
        chapters.append({
            "id": cid, "kind": kind, "part": cur_part if kind == "kapitel" else (0 if kind == "prolog" else 3),
            "partStart": bool(part), "label": label, "title": short, "head": inline(head) if head else "",
            "html": h, "words": words(h),
        })

    glossary = {}
    anhang = KAP / "99-anhang.md"
    if anhang.exists():
        for j, sec in enumerate(split_anhang(anhang)):
            if sec["title"].lower().startswith("glossar"):
                glossary = glossary_from(sec["lines"])
            h = blocks_to_html(sec["lines"])
            chapters.append({
                "id": f"anhang-{j + 1}", "kind": "anhang", "part": 4, "partStart": j == 0,
                "label": "Anhang", "title": sec["title"], "head": "", "html": h, "words": words(h),
            })

    # Glossar-Hinweise an kursiven Fremdwörtern im Romantext
    if glossary:
        def mark(m):
            t = m.group(1)
            key = re.sub(r"[^\wäöüß\- ]", "", t.lower()).strip()
            if key in glossary:
                return f'<em class="gl" tabindex="0" data-gl="{html.escape(glossary[key], quote=True)}">{t}</em>'
            return m.group(0)
        for c in chapters:
            if c["kind"] != "anhang":
                c["html"] = re.sub(r"<em>([^<]{1,40})</em>", mark, c["html"])

    book = {
        "title": "Was der Berg behält",
        "subtitle": "Roman vom Donnersberg",
        "parts": PARTS,
        "chapters": chapters,
        "totalWords": sum(c["words"] for c in chapters if c["kind"] != "anhang"),
        "glossaryTerms": len(glossary),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(chapters)} Abschnitte, {book['totalWords']} Wörter Romantext, {len(glossary)} Glossarbegriffe -> {OUT}")


if __name__ == "__main__":
    main()
