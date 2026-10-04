#!/usr/bin/env python3
"""Erzeugt die Übungsbilder (SVG) für die Unterrichtsreihe „Bildbeschreibung" Klasse 5."""
import os, math

OUT = os.path.join(os.path.dirname(__file__), "..", "bilder")
W, H = 800, 560
SKIN = ["#f6d1b1", "#e8b48f", "#c68b5e", "#8d5a3b", "#f1c7a3"]


def svg(body, title, w=W, h=H):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'font-family="Nunito, Arial, sans-serif"><title>{title}</title>\n{body}\n</svg>\n')


def save(name, body, title, w=W, h=H):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(svg(body, title, w, h))


# ---------------------------------------------------------------- Bausteine
def cloud(x, y, s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})" fill="#fff">'
            '<ellipse cx="0" cy="0" rx="40" ry="18"/><circle cx="-18" cy="-12" r="18"/>'
            '<circle cx="12" cy="-18" r="22"/><circle cx="34" cy="-4" r="14"/></g>')


def sun(x, y, r=34):
    rays = "".join(
        f'<line x1="{x + math.cos(a) * (r + 8):.1f}" y1="{y + math.sin(a) * (r + 8):.1f}" '
        f'x2="{x + math.cos(a) * (r + 22):.1f}" y2="{y + math.sin(a) * (r + 22):.1f}"/>'
        for a in [i * math.pi / 6 for i in range(12)])
    return (f'<g stroke="#f7b500" stroke-width="5" stroke-linecap="round">{rays}</g>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="#ffd23f" stroke="#f7b500" stroke-width="3"/>')


def tree(x, y, s=1.0, crown="#4caf50", crown2="#3d9142", trunk="#8b5a2b"):
    return (f'<g transform="translate({x},{y}) scale({s})">'
            f'<path d="M-9 0 L-7 -70 L7 -70 L9 0 Z" fill="{trunk}"/>'
            f'<path d="M0 -55 L-22 -80 M2 -62 L20 -84" stroke="{trunk}" stroke-width="6" stroke-linecap="round"/>'
            f'<circle cx="-30" cy="-95" r="32" fill="{crown2}"/><circle cx="28" cy="-98" r="34" fill="{crown2}"/>'
            f'<circle cx="0" cy="-120" r="40" fill="{crown}"/><circle cx="-24" cy="-88" r="26" fill="{crown}"/>'
            f'<circle cx="24" cy="-86" r="26" fill="{crown}"/></g>')


def fir(x, y, s=1.0, c="#2e7d4f"):
    return (f'<g transform="translate({x},{y}) scale({s})"><rect x="-5" y="-14" width="10" height="14" fill="#6d4321"/>'
            f'<path d="M0 -90 L-26 -40 L-14 -40 L-32 -12 L32 -12 L14 -40 L26 -40 Z" fill="{c}"/></g>')


def flower(x, y, c="#ff6fa8", s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M0 0 V-18" stroke="#3d9142" stroke-width="2.5"/>'
            f'<g fill="{c}"><circle cx="0" cy="-24" r="4.5"/><circle cx="-5" cy="-19" r="4.5"/><circle cx="5" cy="-19" r="4.5"/>'
            f'<circle cx="-3" cy="-13" r="4"/><circle cx="3" cy="-13" r="4"/></g><circle cx="0" cy="-18" r="3.2" fill="#ffd23f"/></g>')


def grass_tufts(pts, c="#3d9142"):
    return "".join(f'<path d="M{x} {y} l-4 -10 M{x} {y} l0 -13 M{x} {y} l4 -10" stroke="{c}" stroke-width="2" stroke-linecap="round" fill="none"/>' for x, y in pts)


def house(x, y, w, h, wall="#f4e1c1", roof="#c0392b", door="#8b5a2b", chimney=True, windows=2):
    out = f'<g><rect x="{x}" y="{y - h}" width="{w}" height="{h}" fill="{wall}" stroke="#5b4636" stroke-width="2"/>'
    if chimney:
        out += f'<rect x="{x + w * 0.65}" y="{y - h - h * 0.55}" width="{w * 0.1}" height="{h * 0.35}" fill="#7a3b2e"/>'
    out += f'<polygon points="{x - 8},{y - h} {x + w / 2},{y - h - h * 0.6} {x + w + 8},{y - h}" fill="{roof}" stroke="#5b4636" stroke-width="2"/>'
    dw = w * 0.22
    out += f'<rect x="{x + w / 2 - dw / 2}" y="{y - h * 0.55}" width="{dw}" height="{h * 0.55}" fill="{door}"/>'
    if windows:
        ww = w * 0.2
        for wx in (x + w * 0.1, x + w * 0.7):
            out += (f'<rect x="{wx}" y="{y - h * 0.75}" width="{ww}" height="{ww}" fill="#bfe3ff" stroke="#5b4636" stroke-width="2"/>'
                    f'<path d="M{wx + ww / 2} {y - h * 0.75} v{ww} M{wx} {y - h * 0.75 + ww / 2} h{ww}" stroke="#5b4636" stroke-width="1.5"/>')
    return out + "</g>"


def hair(style, hc, hx, hy, r):
    if style == "short":
        return f'<path d="M{hx - r} {hy} a{r} {r} 0 0 1 {2 * r} 0 q-{r} -{r * 0.55} -{2 * r} 0 z" fill="{hc}"/>'
    if style == "long":
        return (f'<path d="M{hx - r - 2} {hy + r * 1.6} Q{hx - r - 5} {hy - r * 1.3} {hx} {hy - r - 2} '
                f'Q{hx + r + 5} {hy - r * 1.3} {hx + r + 2} {hy + r * 1.6} L{hx + r - 3} {hy + r * 1.6} '
                f'Q{hx + r} {hy - r * 0.2} {hx} {hy - r * 0.55} Q{hx - r} {hy - r * 0.2} {hx - r + 3} {hy + r * 1.6} Z" fill="{hc}"/>')
    if style == "pony":
        return (f'<path d="M{hx - r} {hy} a{r} {r} 0 0 1 {2 * r} 0 q-{r} -{r * 0.55} -{2 * r} 0 z" fill="{hc}"/>'
                f'<path d="M{hx + r - 2} {hy - r * 0.5} q{r * 0.9} {r * 0.3} {r * 0.6} {r * 1.6} q-{r * 0.3} -{r * 0.6} -{r * 0.7} -{r * 0.9} z" fill="{hc}"/>')
    if style == "braids":
        return (f'<path d="M{hx - r} {hy} a{r} {r} 0 0 1 {2 * r} 0 q-{r} -{r * 0.55} -{2 * r} 0 z" fill="{hc}"/>'
                f'<rect x="{hx - r - 4}" y="{hy - 2}" width="6" height="{r * 1.7}" rx="3" fill="{hc}"/>'
                f'<rect x="{hx + r - 2}" y="{hy - 2}" width="6" height="{r * 1.7}" rx="3" fill="{hc}"/>')
    if style == "curly":
        return "".join(f'<circle cx="{hx + math.cos(a) * r * 0.95:.1f}" cy="{hy + math.sin(a) * r * 0.95:.1f}" r="{r * 0.38:.1f}" fill="{hc}"/>'
                       for a in [math.pi + i * math.pi / 6 for i in range(7)])
    if style == "bun":
        return (f'<path d="M{hx - r} {hy} a{r} {r} 0 0 1 {2 * r} 0 q-{r} -{r * 0.55} -{2 * r} 0 z" fill="{hc}"/>'
                f'<circle cx="{hx}" cy="{hy - r - 3}" r="{r * 0.45}" fill="{hc}"/>')
    if style == "bald":
        return f'<path d="M{hx - r} {hy + 2} q-2 -6 2 -9 M{hx + r} {hy + 2} q2 -6 -2 -9" stroke="{hc}" stroke-width="4" fill="none"/>'
    if style.startswith("cap"):
        cc = style.split(":")[1]
        return (f'<path d="M{hx - r} {hy - 2} a{r} {r} 0 0 1 {2 * r} 0 z" fill="{cc}"/>'
                f'<rect x="{hx - 2}" y="{hy - 5}" width="{r + 10}" height="5" rx="2" fill="{cc}"/>')
    if style.startswith("hat"):
        cc = style.split(":")[1]
        return (f'<ellipse cx="{hx}" cy="{hy - r * 0.4}" rx="{r * 1.6}" ry="{r * 0.35}" fill="{cc}"/>'
                f'<path d="M{hx - r * 0.8} {hy - r * 0.4} q0 -{r * 1.1} {r * 0.8} -{r * 1.1} q{r * 0.8} 0 {r * 0.8} {r * 1.1} z" fill="{cc}"/>')
    return ""


def person(x, y, s=1.0, skin=SKIN[0], hair_style="short", hc="#5b3a1e", top="#3b82f6", bottom="#334155",
           kind="pants", arms="down", shoes="#333", legs="stand", face="smile", beard=None, extra="", flip=False):
    """Figur, Füße bei (x,y). kind: pants/skirt/dress/shorts. arms: down/up/wave/forward/hold/hips/out."""
    g = [f'<g transform="translate({x},{y}) scale({-s if flip else s},{s})">']
    # Beine
    if legs == "stand":
        lc = skin if kind in ("skirt", "dress", "shorts") else bottom
        g.append(f'<rect x="-11" y="-42" width="9" height="40" rx="3" fill="{lc}"/><rect x="2" y="-42" width="9" height="40" rx="3" fill="{lc}"/>')
        if kind == "shorts":
            g.append(f'<path d="M-13 -46 h26 v18 h-11 l-2 -6 l-2 6 h-11 z" fill="{bottom}"/>')
        g.append(f'<ellipse cx="-8" cy="-2" rx="8" ry="4" fill="{shoes}"/><ellipse cx="8" cy="-2" rx="8" ry="4" fill="{shoes}"/>')
    elif legs == "walk":
        lc = skin if kind in ("skirt", "dress", "shorts") else bottom
        g.append(f'<path d="M-4 -44 L-16 -3" stroke="{lc}" stroke-width="9" stroke-linecap="round"/>'
                 f'<path d="M4 -44 L14 -3" stroke="{lc}" stroke-width="9" stroke-linecap="round"/>')
        if kind == "shorts":
            g.append(f'<path d="M-13 -46 h26 v16 h-26 z" fill="{bottom}"/>')
        g.append(f'<ellipse cx="-19" cy="-2" rx="8" ry="4" fill="{shoes}"/><ellipse cx="18" cy="-2" rx="8" ry="4" fill="{shoes}"/>')
    elif legs == "jump":
        lc = skin if kind in ("skirt", "dress", "shorts") else bottom
        g.append(f'<path d="M-6 -44 q-10 14 -2 26" stroke="{lc}" stroke-width="9" fill="none" stroke-linecap="round"/>'
                 f'<path d="M6 -44 q10 14 2 26" stroke="{lc}" stroke-width="9" fill="none" stroke-linecap="round"/>')
        g.append(f'<ellipse cx="-9" cy="-16" rx="8" ry="4" fill="{shoes}"/><ellipse cx="9" cy="-16" rx="8" ry="4" fill="{shoes}"/>')
    elif legs == "sit":
        lc = skin if kind in ("skirt", "dress", "shorts") else bottom
        g.append(f'<rect x="-10" y="-40" width="38" height="11" rx="5" fill="{bottom if kind != "dress" else top}"/>'
                 f'<rect x="20" y="-38" width="9" height="34" rx="3" fill="{lc}"/>'
                 f'<ellipse cx="29" cy="-3" rx="8" ry="4" fill="{shoes}"/>')
    elif legs == "sitflat":  # sitzt auf dem Boden, Beine nach vorn ausgestreckt
        lc = skin if kind in ("skirt", "dress", "shorts") else bottom
        g.append(f'<rect x="-10" y="-14" width="52" height="11" rx="5" fill="{lc}"/>'
                 f'<ellipse cx="44" cy="-9" rx="5" ry="8" fill="{shoes}"/>')
        if kind in ("skirt", "dress"):
            g.append(f'<path d="M-16 -40 h32 l10 37 h-48 z" fill="{bottom if kind == "skirt" else top}"/>')
    # Rumpf
    by = -44 if legs not in ("sitflat",) else -14
    if kind == "dress":
        g.append(f'<path d="M-13 {by - 34} h26 l9 {38 if legs == "stand" or legs == "walk" else 30} h-44 z" fill="{top}"/>')
    else:
        g.append(f'<rect x="-15" y="{by - 34}" width="30" height="38" rx="9" fill="{top}"/>')
        if kind == "skirt" and legs in ("stand", "walk", "jump"):
            g.append(f'<path d="M-15 {by - 2} h30 l7 20 h-44 z" fill="{bottom}"/>')
        elif kind == "pants" and legs in ("stand", "walk", "jump"):
            g.append(f'<rect x="-13" y="{by - 2}" width="26" height="8" fill="{bottom}"/>')
    # Arme
    sy = by - 29
    A = {
        "down": [(-14, sy, -20, sy + 30), (14, sy, 20, sy + 30)],
        "up": [(-14, sy, -26, sy - 26), (14, sy, 26, sy - 26)],
        "wave": [(-14, sy, -20, sy + 30), (14, sy, 30, sy - 22)],
        "forward": [(-14, sy, -20, sy + 28), (14, sy, 38, sy + 8)],
        "both": [(-14, sy, 30, sy + 10), (14, sy, 38, sy + 8)],
        "hold": [(-14, sy, -22, sy + 22), (14, sy, 22, sy + 22)],
        "hips": [(-14, sy, -26, sy + 14), (14, sy, 26, sy + 14)],
        "out": [(-14, sy, -40, sy + 6), (14, sy, 40, sy + 6)],
        "read": [(-14, sy, 4, sy + 14), (14, sy, 18, sy + 12)],
    }[arms]
    for (x1, y1, x2, y2) in A:
        g.append(f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{top}" stroke-width="8" stroke-linecap="round"/>'
                 f'<circle cx="{x2}" cy="{y2}" r="5" fill="{skin}"/>')
    # Kopf
    hy = by - 48
    r = 14
    if hair_style == "long":
        g.append(hair("long", hc, 0, hy, r))
    g.append(f'<rect x="-4" y="{by - 38}" width="8" height="6" fill="{skin}"/>')
    g.append(f'<circle cx="0" cy="{hy}" r="{r}" fill="{skin}"/>')
    if beard:
        g.append(f'<path d="M-12 {hy + 2} q12 22 24 0 q-12 8 -24 0 z" fill="{beard}"/>')
    if face == "smile":
        g.append(f'<circle cx="-5" cy="{hy - 1}" r="1.8" fill="#2b2b2b"/><circle cx="5" cy="{hy - 1}" r="1.8" fill="#2b2b2b"/>'
                 f'<path d="M-5 {hy + 5} q5 4 10 0" stroke="#2b2b2b" stroke-width="1.6" fill="none" stroke-linecap="round"/>')
    elif face == "back":
        pass
    elif face == "laugh":
        g.append(f'<path d="M-7 {hy - 1} q2 -3 4 0 M3 {hy - 1} q2 -3 4 0" stroke="#2b2b2b" stroke-width="1.6" fill="none"/>'
                 f'<path d="M-5 {hy + 4} q5 6 10 0 z" fill="#8b2323"/>')
    if hair_style != "long":
        g.append(hair(hair_style, hc, 0, hy, r))
    if face == "back":
        g.append(f'<circle cx="0" cy="{hy}" r="{r}" fill="{hc}"/>')
    g.append(extra)
    g.append('</g>')
    return "".join(g)


def dog(x, y, s=1.0, c="#a0672d", collar="#e53935", flip=False, pose="run"):
    fl = -1 if flip else 1
    legs = ('<path d="M-22 -10 l-10 12 M-12 -10 l-2 14 M14 -10 l8 13 M24 -10 l14 8" stroke="{c}" stroke-width="7" stroke-linecap="round"/>' if pose == "run"
            else '<path d="M-20 -10 v14 M-10 -10 v14 M14 -10 v14 M24 -10 v14" stroke="{c}" stroke-width="7" stroke-linecap="round"/>').format(c=c)
    return (f'<g transform="translate({x},{y}) scale({s * fl},{s})">{legs}'
            f'<ellipse cx="0" cy="-18" rx="32" ry="15" fill="{c}"/>'
            f'<path d="M-30 -24 q-18 -10 -14 -26" stroke="{c}" stroke-width="6" fill="none" stroke-linecap="round"/>'
            f'<circle cx="34" cy="-34" r="14" fill="{c}"/><ellipse cx="46" cy="-30" rx="10" ry="7" fill="{c}"/>'
            f'<circle cx="55" cy="-31" r="3.5" fill="#222"/><circle cx="37" cy="-38" r="2.2" fill="#222"/>'
            f'<path d="M28 -44 q-10 4 -8 20 q6 -6 10 -16 z" fill="#6b3f17"/>'
            f'<path d="M24 -26 q8 6 18 0" stroke="{collar}" stroke-width="5" fill="none"/></g>')


def cat(x, y, s=1.0, c="#7d7d7d", flip=False, sleeping=False):
    fl = -1 if flip else 1
    if sleeping:
        return (f'<g transform="translate({x},{y}) scale({s * fl},{s})">'
                f'<ellipse cx="0" cy="-12" rx="30" ry="13" fill="{c}"/><circle cx="24" cy="-16" r="11" fill="{c}"/>'
                f'<path d="M17 -24 l3 -9 l5 7 z M27 -25 l5 -8 l2 9 z" fill="{c}"/>'
                f'<path d="M20 -16 q2 2 4 0 M27 -16 q2 2 4 0" stroke="#222" stroke-width="1.4" fill="none"/>'
                f'<path d="M-28 -6 q-6 8 14 8 q20 0 24 -4" stroke="{c}" stroke-width="5" fill="none" stroke-linecap="round"/></g>')
    return (f'<g transform="translate({x},{y}) scale({s * fl},{s})">'
            f'<path d="M-16 -2 q-18 -10 -10 -36" stroke="{c}" stroke-width="5" fill="none" stroke-linecap="round"/>'
            f'<ellipse cx="0" cy="-18" rx="16" ry="20" fill="{c}"/><circle cx="2" cy="-44" r="13" fill="{c}"/>'
            f'<path d="M-9 -52 l2 -12 l8 7 z M5 -57 l8 -7 l1 12 z" fill="{c}"/>'
            f'<circle cx="-2" cy="-45" r="2" fill="#2f2"/><circle cx="7" cy="-45" r="2" fill="#2f2"/>'
            f'<path d="M0 -39 l2 2 l2 -2" stroke="#222" stroke-width="1.2" fill="none"/></g>')


def duck(x, y, s=1.0, c="#8d6e4c", head="#2e7d32"):
    return (f'<g transform="translate({x},{y}) scale({s})"><ellipse cx="0" cy="0" rx="18" ry="9" fill="{c}"/>'
            f'<path d="M14 -3 q4 -12 -2 -16" stroke="{c}" stroke-width="5" fill="none"/>'
            f'<circle cx="12" cy="-18" r="7" fill="{head}"/><path d="M18 -18 l9 2 l-9 2 z" fill="#ffb300"/>'
            f'<circle cx="13" cy="-20" r="1.3" fill="#111"/></g>')


def bird(x, y, s=1.0, c="#555"):
    return f'<path transform="translate({x},{y}) scale({s})" d="M-14 0 q7 -9 14 0 q7 -9 14 0" stroke="{c}" stroke-width="2.5" fill="none" stroke-linecap="round"/>'


def gull(x, y, s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M-20 -2 q10 -12 20 0 q10 -12 20 0" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>'
            f'<path d="M-20 -2 q10 -12 20 0 q10 -12 20 0" stroke="#90a4ae" stroke-width="1.5" fill="none"/></g>')


# ================================================================ BILD 1: Sommertag am See
def bild_see():
    b = []
    b.append('<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc7ff"/><stop offset="1" stop-color="#d5efff"/></linearGradient>'
             '<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa3df"/><stop offset="1" stop-color="#2f80c4"/></linearGradient></defs>')
    b.append(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
    b.append(sun(700, 70))
    b.append(cloud(180, 70, 1.1) + cloud(430, 50, 0.8))
    # Hügel
    b.append('<path d="M0 250 Q120 150 260 220 Q380 170 520 215 Q650 160 800 210 V300 H0 Z" fill="#8bc98a"/>')
    b.append('<path d="M0 270 Q180 220 360 262 Q560 230 800 255 V300 H0 Z" fill="#6fb36e"/>')
    # Haus auf dem Hügel links
    b.append(house(70, 222, 70, 48))
    # Wald rechts
    for i, fx in enumerate([600, 630, 660, 690, 720, 750, 780, 615, 675, 735]):
        b.append(fir(fx, 262 + (i % 3) * 4 + (8 if i > 6 else 0), 0.8 + (i % 2) * 0.15))
    # See
    b.append('<path d="M0 282 Q400 268 800 282 V392 Q560 410 400 400 Q200 392 0 405 Z" fill="url(#lake)"/>')
    b.append('<g stroke="#bfe6ff" stroke-width="2" stroke-linecap="round" opacity=".7"><path d="M90 320 h40 M250 345 h30 M470 315 h50 M540 360 h30 M160 375 h45"/></g>')
    # Segelboot
    b.append('<g transform="translate(360,330)"><path d="M-45 0 h90 l-14 18 h-62 z" fill="#d32f2f"/>'
             '<rect x="-2" y="-78" width="4" height="78" fill="#6d4321"/><path d="M4 -74 L44 -6 H4 Z" fill="#fff"/><path d="M-4 -60 L-34 -6 H-4 Z" fill="#fff"/>'
             '<path d="M2 -78 l14 4 l-14 4 z" fill="#ffb300"/></g>')
    # Enten links im Mittelgrund
    b.append(duck(300, 342, 1.0) + duck(255, 352, 0.85, "#c8a77c", "#8d6e4c"))
    # Steg rechts
    b.append('<g><path d="M800 352 L560 352 L560 366 L800 366 Z" fill="#a1683a"/>'
             + "".join(f'<rect x="{px}" y="362" width="7" height="34" fill="#7a4a24"/>' for px in (570, 640, 710, 780))
             + "".join(f'<line x1="{px}" y1="352" x2="{px}" y2="366" stroke="#7a4a24" stroke-width="1.5"/>' for px in range(580, 800, 20)) + '</g>')
    # Junge angelt am Stegende
    b.append(person(585, 360, 0.75, SKIN[2], "cap:#1e88e5", "#222", "#fdd835", "#1565c0", kind="shorts", legs="sit", arms="forward"))
    b.append('<path d="M618 291 L520 236" stroke="#5d4037" stroke-width="3"/><path d="M520 236 Q505 300 512 360" stroke="#555" stroke-width="1" fill="none"/>'
             '<circle cx="512" cy="360" r="4" fill="#e53935"/>')
    # Wiese Vordergrund
    b.append('<path d="M0 400 Q200 386 400 396 Q600 404 800 390 V560 H0 Z" fill="#7ccf63"/>')
    b.append('<path d="M0 470 Q300 450 800 480 V560 H0 Z" fill="#6cc052"/>')
    b.append(grass_tufts([(40, 430), (300, 420), (470, 512), (610, 440), (760, 520), (240, 540), (520, 470)]))
    # Großer Baum links
    b.append(tree(110, 500, 1.55, "#43a047", "#2e7d32"))
    # Picknickdecke + Mädchen
    b.append('<g transform="translate(150,500)"><path d="M-10 0 L190 0 L160 -44 L20 -44 Z" fill="#fff"/>'
             '<clipPath id="dk"><path d="M-10 0 L190 0 L160 -44 L20 -44 Z"/></clipPath><g clip-path="url(#dk)" fill="#e53935">'
             + "".join(f'<rect x="{-10 + i * 25}" y="-44" width="12.5" height="44"/>' for i in range(9))
             + "".join(f'<rect x="-10" y="{-44 + j * 11}" width="200" height="5.5" opacity=".6"/>' for j in range(4)) + '</g></g>')
    # Korb
    b.append('<g transform="translate(305,478)"><path d="M-22 0 h44 l-5 22 h-34 z" fill="#c68a3e"/><path d="M-16 0 q16 -26 32 0" stroke="#8b5a2b" stroke-width="4" fill="none"/>'
             '<circle cx="-8" cy="-2" r="6" fill="#e53935"/><circle cx="6" cy="-3" r="6" fill="#7cb342"/></g>')
    b.append(person(200, 492, 0.9, SKIN[0], "long", "#6d3f1f", "#1e63d6", "#1e63d6", kind="dress", legs="sitflat", arms="read",
                    extra='<g transform="translate(12,-60)"><path d="M-12 0 l12 4 l12 -4 v-16 l-12 4 l-12 -4 z" fill="#fff" stroke="#888"/><path d="M0 4 v-16" stroke="#888"/></g>'))
    # Hund + Ball
    b.append(dog(420, 470, 1.15, "#a0672d", "#e53935"))
    b.append('<circle cx="530" cy="455" r="13" fill="#e53935"/><path d="M519 450 q11 6 22 0" stroke="#fff" stroke-width="2" fill="none"/>')
    # Fahrrad rechts im Gras
    b.append('<g transform="translate(660,505) rotate(-8)" stroke="#2e7d32" stroke-width="5" fill="none" stroke-linecap="round">'
             '<circle cx="-45" cy="0" r="26" stroke="#333"/><circle cx="45" cy="0" r="26" stroke="#333"/>'
             '<path d="M-45 0 L-10 -38 L35 -38 L45 0 M-10 -38 L5 0 L35 -38 M5 0 L-45 0 M30 -48 L35 -38 M22 -50 h16 M-16 -42 h14"/></g>')
    # Blumen
    for (fx, fy), fc in zip([(30, 545), (62, 530), (500, 548), (545, 535), (585, 550), (735, 452), (768, 466), (360, 548)],
                            ["#ffd23f", "#ff6fa8", "#ffd23f", "#ff6fa8", "#ab47bc", "#ffd23f", "#ff6fa8", "#fff"]):
        b.append(flower(fx, fy, fc, 1.1))
    save("sommertag-am-see.svg", "".join(b), "Sommertag am See")


# ================================================================ BILD 2: Kinderzimmer (A + B)
def bild_zimmer(variant="a"):
    v = variant == "b"
    b = []
    b.append(f'<rect width="{W}" height="{H}" fill="#fff4cc"/>')
    b.append('<path d="M0 400 H800 V560 H0 Z" fill="#d9a066"/>')
    b.append("".join(f'<line x1="0" y1="{y}" x2="800" y2="{y}" stroke="#c48a52" stroke-width="2"/>' for y in (430, 465, 505, 548)))
    b.append('<rect x="0" y="394" width="800" height="10" fill="#f0d9a8"/>')
    # Fenster Mitte
    b.append('<rect x="320" y="90" width="170" height="170" fill="#9fd8ff" stroke="#fff" stroke-width="10"/>'
             '<path d="M405 90 v170 M320 175 h170" stroke="#fff" stroke-width="8"/>'
             + cloud(370, 140, 0.6) + '<circle cx="455" cy="125" r="16" fill="#ffd23f"/>')
    b.append('<path d="M300 78 q30 100 0 196 h26 q-10 -100 0 -196 z" fill="#42a5f5"/><path d="M510 78 q-30 100 0 196 h-26 q10 -100 0 -196 z" fill="#42a5f5"/>'
             '<rect x="292" y="70" width="226" height="10" rx="4" fill="#8b5a2b"/>')
    b.append('<rect x="310" y="262" width="190" height="12" fill="#e0c08f"/>')
    # Pflanze auf Fensterbank
    fl = "#e53935" if not v else "#ffd23f"
    b.append(f'<g transform="translate(470,262)"><path d="M-14 0 l3 -26 h22 l3 26 z" fill="#d35400"/>'
             f'<path d="M0 -26 q-20 -20 -12 -42 M0 -26 q4 -26 18 -36 M0 -26 q-2 -30 0 -48" stroke="#2e7d32" stroke-width="4" fill="none"/>'
             f'<circle cx="0" cy="-76" r="8" fill="{fl}"/><circle cx="0" cy="-76" r="3" fill="#fff59d"/></g>')
    # Bett links
    b.append('<g><rect x="20" y="300" width="250" height="70" rx="8" fill="#1e63d6"/><rect x="20" y="230" width="18" height="170" fill="#8b5a2b"/>'
             '<rect x="262" y="290" width="16" height="110" fill="#8b5a2b"/><rect x="34" y="368" width="236" height="16" fill="#8b5a2b"/>'
             '<rect x="40" y="280" width="70" height="30" rx="12" fill="#fff"/>'
             '<path d="M100 300 h170 v30 q-90 14 -170 0 z" fill="#3f8cff"/>'
             + "".join(f'<circle cx="{cx}" cy="{cy}" r="5" fill="#fff" opacity=".7"/>' for cx, cy in [(130, 340), (170, 355), (210, 338), (240, 352), (150, 318), (220, 316)]) + '</g>')
    # Teddy auf dem Kissen
    b.append('<g transform="translate(76,282)"><circle cx="0" cy="-12" r="15" fill="#b5793f"/><circle cx="-11" cy="-26" r="6" fill="#b5793f"/><circle cx="11" cy="-26" r="6" fill="#b5793f"/>'
             '<ellipse cx="0" cy="-6" rx="7" ry="5" fill="#e0b48a"/><circle cx="-5" cy="-15" r="1.8" fill="#222"/><circle cx="5" cy="-15" r="1.8" fill="#222"/>'
             '<ellipse cx="0" cy="12" rx="16" ry="14" fill="#b5793f"/><path d="M-6 0 l6 4 l6 -4 l0 6 l-6 -2 l-6 2 z" fill="#e53935"/></g>')
    # Ball unter dem Bett
    bc = "#fff" if not v else "#fdd835"
    b.append(f'<g transform="translate(200,388)"><circle r="15" fill="{bc}" stroke="#222" stroke-width="2"/><path d="M0 -6 l6 4 l-2 7 h-8 l-2 -7 z" fill="#222"/></g>')
    # Socken neben dem Bett
    b.append('<path d="M120 460 h12 v18 h14 v10 h-26 z" fill="#ab47bc"/><path d="M152 470 h12 v18 h14 v10 h-26 z" fill="#ab47bc" transform="rotate(12 164 480)"/>')
    # Poster über dem Bett
    if not v:
        b.append('<g transform="translate(70,110)"><rect width="150" height="110" fill="#1a237e" stroke="#fff" stroke-width="6"/>'
                 '<circle cx="20" cy="20" r="2" fill="#fff"/><circle cx="125" cy="30" r="2" fill="#fff"/><circle cx="40" cy="90" r="2" fill="#fff"/><circle cx="130" cy="88" r="2" fill="#fff"/>'
                 '<g transform="translate(75,58) rotate(35)"><path d="M0 -40 q14 14 12 40 h-24 q-2 -26 12 -40 z" fill="#eceff1"/><circle cy="-12" r="5" fill="#42a5f5"/>'
                 '<path d="M-12 0 l-8 12 h8 z M12 0 l8 12 h-8 z" fill="#e53935"/><path d="M-6 2 q6 20 12 0 z" fill="#ff9800"/></g></g>')
    else:
        b.append('<g transform="translate(70,110)"><rect width="150" height="110" fill="#1a237e" stroke="#fff" stroke-width="6"/>'
                 '<circle cx="75" cy="55" r="26" fill="#ff9800"/><ellipse cx="75" cy="55" rx="46" ry="9" fill="none" stroke="#ffe0b2" stroke-width="4"/>'
                 '<circle cx="20" cy="20" r="2" fill="#fff"/><circle cx="125" cy="30" r="2" fill="#fff"/></g>')
    # Regal rechts vom Fenster
    b.append('<g><rect x="540" y="130" width="100" height="270" fill="#a0683a"/><rect x="548" y="138" width="84" height="254" fill="#7a4a24"/>'
             + "".join(f'<rect x="548" y="{y}" width="84" height="6" fill="#a0683a"/>' for y in (200, 265, 330)) + '</g>')
    books1 = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa"] if not v else ["#e53935", "#1e88e5", "#43a047"]
    b.append("".join(f'<rect x="{552 + i * 14}" y="{150 + (i % 2) * 6}" width="12" height="{50 - (i % 2) * 6}" fill="{c}"/>' for i, c in enumerate(books1)))
    b.append("".join(f'<rect x="{552 + i * 13}" y="{218 + (i % 3) * 4}" width="11" height="{47 - (i % 3) * 4}" fill="{c}"/>' for i, c in enumerate(["#ff7043", "#26a69a", "#5c6bc0", "#ffca28", "#ec407a", "#8d6e63"])))
    # Spielzeugkiste unten im Regal: Auto
    b.append('<g transform="translate(590,318)"><rect x="-28" y="-14" width="56" height="12" rx="4" fill="#e53935"/><path d="M-16 -14 l6 -10 h20 l6 10 z" fill="#e53935"/>'
             '<circle cx="-16" cy="-1" r="6" fill="#222"/><circle cx="16" cy="-1" r="6" fill="#222"/></g>')
    b.append('<g transform="translate(590,392)"><rect x="-34" y="-50" width="68" height="50" fill="#26a69a"/><text x="0" y="-18" text-anchor="middle" font-size="14" fill="#fff" font-weight="700">SPIELE</text></g>')
    # Schreibtisch rechts
    b.append('<g><rect x="660" y="300" width="140" height="14" fill="#8b5a2b"/><rect x="668" y="314" width="10" height="90" fill="#8b5a2b"/><rect x="780" y="314" width="10" height="90" fill="#8b5a2b"/></g>')
    lamp = "#fdd835" if not v else "#43a047"
    b.append(f'<g transform="translate(770,300)"><ellipse cx="0" cy="-3" rx="16" ry="4" fill="#555"/><path d="M0 -3 L-14 -50 L-30 -60" stroke="#555" stroke-width="4" fill="none"/>'
             f'<path d="M-30 -60 l-22 22 h30 z" fill="{lamp}"/></g>')
    b.append('<g transform="translate(690,300)"><rect x="-12" y="-8" width="40" height="8" fill="#1e88e5"/><rect x="-10" y="-16" width="36" height="8" fill="#e53935"/><rect x="-14" y="-24" width="42" height="8" fill="#43a047"/></g>')
    # Uhr über dem Schreibtisch
    hand = "M0 0 L0 -16 M0 0 L11 0" if not v else "M0 0 L0 -16 M0 0 L-11 0"
    b.append(f'<g transform="translate(730,170)"><circle r="26" fill="#fff" stroke="#e53935" stroke-width="6"/>'
             f'<path d="{hand}" stroke="#222" stroke-width="3" stroke-linecap="round"/><circle r="2.5" fill="#222"/></g>')
    # Stuhl vor dem Schreibtisch + Rucksack
    b.append('<g><rect x="690" y="340" width="70" height="10" fill="#e53935"/><rect x="694" y="350" width="8" height="58" fill="#b71c1c"/><rect x="748" y="350" width="8" height="58" fill="#b71c1c"/>'
             '<rect x="748" y="270" width="8" height="80" fill="#b71c1c"/></g>')
    if not v:
        b.append('<g transform="translate(752,300)"><rect x="-6" y="0" width="34" height="44" rx="8" fill="#ff9800"/><rect x="-2" y="20" width="26" height="16" rx="4" fill="#f57c00"/></g>')
    # Gitarre hinter dem Stuhl (an Wand gelehnt)
    b.append('<g transform="translate(318,420) rotate(-10)"><ellipse cx="0" cy="-20" rx="26" ry="30" fill="#c0702e"/><ellipse cx="0" cy="-58" rx="19" ry="20" fill="#c0702e"/>'
             '<circle cx="0" cy="-30" r="8" fill="#4e2a10"/><rect x="-4" y="-150" width="8" height="100" fill="#4e2a10"/><rect x="-7" y="-168" width="14" height="20" rx="3" fill="#4e2a10"/></g>')
    # Teppich + Katze
    b.append('<ellipse cx="420" cy="470" rx="140" ry="40" fill="#81c784"/><ellipse cx="420" cy="470" rx="110" ry="28" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="10 8"/>')
    if not v:
        b.append(cat(420, 478, 1.3, "#555", sleeping=True))
    else:
        b.append(cat(565, 140, 1.0, "#555", sleeping=True))  # Katze oben auf dem Regal
    save(f"kinderzimmer{'-b' if v else ''}.svg", "".join(b), "Das Kinderzimmer" + (" (Fehlerbild)" if v else ""))


# ================================================================ BILD 3: Wochenmarkt
def awning(x, y, w, c1, c2, n=8):
    sw = w / n
    out = "".join(f'<rect x="{x + i * sw}" y="{y}" width="{sw}" height="34" fill="{c1 if i % 2 == 0 else c2}"/>' for i in range(n))
    out += "".join(f'<path d="M{x + i * sw} {y + 34} q{sw / 2} 16 {sw} 0 z" fill="{c1 if i % 2 == 0 else c2}"/>' for i in range(n))
    return out


def bild_markt():
    b = []
    b.append(f'<rect width="{W}" height="{H}" fill="#bfe6ff"/>')
    b.append(cloud(640, 60, 0.9) + cloud(120, 48, 0.7))
    # Häuserzeile Hintergrund
    cols = ["#f8bbd0", "#fff59d", "#b3e5fc", "#ffccbc", "#c8e6c9", "#d1c4e9"]
    for i, c in enumerate(cols):
        x = i * 135 - 10
        h = 170 + (i % 3) * 25
        b.append(f'<rect x="{x}" y="{300 - h}" width="135" height="{h}" fill="{c}" stroke="#8d6e63" stroke-width="2"/>'
                 f'<polygon points="{x},{300 - h} {x + 67},{300 - h - 50} {x + 135},{300 - h}" fill="#a1503a" stroke="#8d6e63" stroke-width="2"/>')
        for wy in (300 - h + 25, 300 - h + 80):
            for wx in (x + 22, x + 82):
                if wy < 220:
                    b.append(f'<rect x="{wx}" y="{wy}" width="30" height="36" fill="#fff" stroke="#8d6e63" stroke-width="2"/><rect x="{wx + 3}" y="{wy + 3}" width="24" height="30" fill="#90caf9"/>')
    # Kirchturm mit Uhr
    b.append('<g><rect x="370" y="40" width="60" height="200" fill="#e0d6c8" stroke="#8d6e63" stroke-width="2"/><polygon points="362,40 400,-20 438,40" fill="#4e7d5b" stroke="#2e5d3b" stroke-width="2"/>'
             '<circle cx="400" cy="85" r="18" fill="#fff" stroke="#8d6e63" stroke-width="3"/><path d="M400 85 v-12 M400 85 h-9" stroke="#222" stroke-width="2.5"/>'
             '<path d="M388 140 h24 v40 h-24 z" fill="#5d4037"/></g>')
    # Pflaster
    b.append('<path d="M0 300 H800 V560 H0 Z" fill="#cfc6bb"/>')
    b.append("".join(f'<path d="M0 {y} H800" stroke="#b8ada0" stroke-width="2"/>' for y in range(320, 560, 26)))
    b.append("".join(f'<path d="M{x + (y // 26 % 2) * 20} {y} v26" stroke="#b8ada0" stroke-width="2"/>' for y in range(320, 540, 26) for x in range(0, 800, 40)))
    # Stand 1: Obst (links), rot-weiße Markise
    b.append('<g><rect x="30" y="200" width="6" height="170" fill="#6d4c41"/><rect x="250" y="200" width="6" height="170" fill="#6d4c41"/>'
             + awning(20, 190, 245, "#e53935", "#fff", 9) + '</g>')
    # Verkäufer mit Schnurrbart hinter dem Stand
    b.append(person(110, 362, 1.05, SKIN[1], "bald", "#555", "#fff", "#455a64", arms="forward",
                    extra='<path d="M-9 -84 q9 6 18 0 q-9 -4 -18 0 z" fill="#555"/>'))
    b.append('<path d="M140 288 h22 l3 28 h-28 z" fill="#d7b48a"/>')  # Papiertüte in der Hand
    b.append('<rect x="30" y="330" width="226" height="60" fill="#8d6e63"/><rect x="30" y="322" width="226" height="10" fill="#6d4c41"/>')
    # Obstkisten
    b.append('<g>' + "".join(f'<circle cx="{50 + i * 12}" cy="{318 - (i % 2) * 6}" r="8" fill="#e53935"/>' for i in range(5))
             + "".join(f'<circle cx="{120 + i * 12}" cy="{318 - (i % 2) * 6}" r="8" fill="#fb8c00"/>' for i in range(5))
             + '<g fill="#fdd835">' + "".join(f'<path d="M{190 + i * 10} 322 q6 -26 22 -30 q-12 10 -12 30 z"/>' for i in range(4)) + '</g>'
             + '<text x="120" y="372" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">FRISCHES OBST</text></g>')
    # Frau mit Hut kauft
    b.append(person(250, 455, 1.15, SKIN[3], "hat:#7b1fa2", "#222", "#ffb300", "#5d4037", kind="skirt", arms="forward", face="smile", flip=True,
                    extra='<path d="M-20 -60 q-4 14 2 22 h-14 q4 -10 -2 -22" fill="none"/><rect x="-30" y="-48" width="22" height="18" rx="4" fill="#7b1fa2"/><path d="M-26 -48 q7 -12 14 0" stroke="#7b1fa2" stroke-width="2.5" fill="none"/>'))
    # Stand 2: Blumen (Mitte), grüne Markise
    b.append('<g><rect x="300" y="230" width="6" height="140" fill="#6d4c41"/><rect x="500" y="230" width="6" height="140" fill="#6d4c41"/>'
             + awning(290, 222, 225, "#43a047", "#c8e6c9", 8) + '</g>')
    for i, (bx, fc) in enumerate([(330, "#ffd23f"), (380, "#e53935"), (430, "#ec407a"), (478, "#fff")]):
        b.append(f'<path d="M{bx - 16} 360 h32 l-4 30 h-24 z" fill="#78909c"/>')
        for k in range(5):
            if fc == "#ffd23f":  # Sonnenblumen
                b.append(f'<path d="M{bx - 8 + k * 4} 360 V{306 - k % 2 * 10}" stroke="#2e7d32" stroke-width="3"/>'
                         f'<circle cx="{bx - 8 + k * 4}" cy="{304 - k % 2 * 10}" r="9" fill="#ffd23f"/><circle cx="{bx - 8 + k * 4}" cy="{304 - k % 2 * 10}" r="4" fill="#6d4c41"/>')
            else:  # Tulpen
                fx = bx - 10 + k * 5
                fy = 318 - (k % 2) * 12
                b.append(f'<path d="M{fx} 360 V{fy}" stroke="#2e7d32" stroke-width="2.5"/><path d="M{fx - 6} {fy} q0 -14 6 -14 q6 0 6 14 q-6 4 -12 0 z" fill="{fc}"/>')
    # Stand 3: Brot (rechts), blaue Markise
    b.append('<g><rect x="560" y="200" width="6" height="170" fill="#6d4c41"/><rect x="770" y="200" width="6" height="170" fill="#6d4c41"/>'
             + awning(550, 190, 235, "#1e88e5", "#fff", 9) + '</g>')
    b.append(person(668, 362, 1.0, SKIN[0], "bun", "#e0a96d", "#fff", "#fff", arms="hips", extra='<path d="M-15 -80 h30 v6 h-30 z" fill="#ff8a80"/>'))
    b.append('<rect x="560" y="330" width="216" height="60" fill="#8d6e63"/><rect x="560" y="322" width="216" height="10" fill="#6d4c41"/>'
             '<text x="668" y="372" text-anchor="middle" font-size="16" font-weight="700" fill="#fff">BÄCKEREI</text>')
    b.append("".join(f'<ellipse cx="{590 + i * 34}" cy="314" rx="16" ry="10" fill="#c68a3e"/><path d="M{580 + i * 34} 312 l6 -4 M{590 + i * 34} 312 l6 -4" stroke="#8b5a2b" stroke-width="2"/>' for i in range(3)))
    b.append("".join(f'<g transform="translate({710 + i * 30},312)"><path d="M-12 4 q-4 -16 12 -14 q16 -2 12 14 M-6 -2 l12 8 M6 -2 l-12 8" stroke="#a0582a" stroke-width="5" fill="none" stroke-linecap="round"/></g>' for i in range(2)))
    # Bäckerin hinter dem Stand
    # Vordergrund: Vater + Mädchen mit Luftballon
    b.append(person(470, 520, 1.45, SKIN[2], "short", "#212121", "#546e7a", "#263238", arms="hold", legs="walk"))
    b.append(person(530, 525, 1.05, SKIN[2], "braids", "#212121", "#f06292", "#fff", kind="dress", arms="up", legs="walk"))
    b.append('<path d="M557 404 Q565 330 590 280" stroke="#555" stroke-width="1.5" fill="none"/><ellipse cx="592" cy="256" rx="22" ry="27" fill="#8e24aa"/><path d="M588 282 l4 -4 l4 4 z" fill="#8e24aa"/><ellipse cx="584" cy="246" rx="5" ry="8" fill="#fff" opacity=".4"/>')
    # Junge auf Roller links
    b.append('<g><path d="M60 525 h70" stroke="#37474f" stroke-width="6" stroke-linecap="round"/><path d="M125 525 L118 445" stroke="#37474f" stroke-width="5"/><path d="M108 445 h22" stroke="#37474f" stroke-width="5" stroke-linecap="round"/>'
             '<circle cx="65" cy="532" r="8" fill="#222"/><circle cx="125" cy="532" r="8" fill="#222"/></g>')
    b.append(person(88, 520, 0.95, SKIN[0], "cap:#e53935", "#d4a017", "#43a047", "#1565c0", kind="shorts", arms="forward"))
    # Taube
    b.append('<g transform="translate(340,520)"><ellipse cx="0" cy="-8" rx="16" ry="10" fill="#90a4ae"/><circle cx="-14" cy="-18" r="7" fill="#78909c"/>'
             '<path d="M-21 -18 l-6 3 l6 1 z" fill="#ff8f00"/><path d="M14 -10 l12 -4 l-4 8 z" fill="#607d8b"/><path d="M-4 0 v6 M4 0 v6" stroke="#e57373" stroke-width="2"/></g>'
             '<circle cx="312" cy="522" r="2" fill="#c68a3e"/><circle cx="305" cy="518" r="2" fill="#c68a3e"/><circle cx="318" cy="516" r="2" fill="#c68a3e"/>')
    save("wochenmarkt.svg", "".join(b), "Auf dem Wochenmarkt")


# ================================================================ BILD 4: Schulhof
def bild_schulhof():
    b = []
    b.append(f'<rect width="{W}" height="{H}" fill="#cde9ff"/>')
    b.append(cloud(90, 50, 0.8) + cloud(700, 40, 1.0))
    # Schulgebäude
    b.append('<g><rect x="140" y="60" width="520" height="200" fill="#c96b4a" stroke="#7b3b26" stroke-width="3"/>'
             '<rect x="130" y="50" width="540" height="16" fill="#7b3b26"/>')
    for row in (85, 165):
        for col in range(6):
            wx = 165 + col * 82
            if row == 165 and col in (2, 3):
                continue
            b.append(f'<rect x="{wx}" y="{row}" width="56" height="52" fill="#d6f0ff" stroke="#fff" stroke-width="4"/><path d="M{wx + 28} {row} v52" stroke="#fff" stroke-width="3"/>')
    b.append('<rect x="352" y="170" width="96" height="90" fill="#455a64"/><path d="M400 170 v90" stroke="#263238" stroke-width="3"/>'
             '<rect x="340" y="150" width="120" height="18" fill="#fff"/><text x="400" y="164" font-size="14" font-weight="800" text-anchor="middle" fill="#7b3b26">SCHULE AM PARK</text>'
             '<circle cx="400" cy="112" r="20" fill="#fff" stroke="#7b3b26" stroke-width="3"/><path d="M400 112 v-14 M400 112 l-10 -5" stroke="#222" stroke-width="2.5"/></g>')
    b.append(tree(70, 290, 1.1) + tree(735, 290, 1.15, "#66bb6a", "#43a047"))
    # Boden
    b.append('<path d="M0 260 H800 V560 H0 Z" fill="#b0a99f"/>')
    b.append('<path d="M0 260 H800 V280 H0 Z" fill="#9e968b"/>')
    # Fußballtor rechts mit zwei Jungen
    b.append('<g stroke="#fff" stroke-width="6" fill="none"><path d="M560 340 V270 H720 V340"/></g>'
             '<g stroke="#fff" stroke-width="1" opacity=".7">' + "".join(f'<path d="M{x} 270 V340"/>' for x in range(575, 720, 15))
             + "".join(f'<path d="M560 {y} H720"/>' for y in range(282, 340, 12)) + '</g>')
    b.append(person(640, 345, 0.8, SKIN[1], "short", "#3e2723", "#fdd835", "#212121", kind="shorts", arms="out", shoes="#e53935"))  # Torwart
    b.append(person(600, 420, 0.95, SKIN[3], "curly", "#111", "#1e88e5", "#fff", kind="shorts", legs="walk", arms="out"))
    b.append('<g transform="translate(622,405)"><circle r="10" fill="#fff" stroke="#222" stroke-width="1.5"/><path d="M0 -4 l4 3 l-1.5 4.5 h-5 l-1.5 -4.5 z" fill="#222"/></g>')
    # Klettergerüst links Mittelgrund
    b.append('<g stroke="#e53935" stroke-width="6" stroke-linecap="round" fill="none"><path d="M60 380 V300 H200 V380 M60 340 H200 M95 300 V380 M130 300 V380 M165 300 V380"/></g>')
    b.append(person(130, 300, 0.75, SKIN[0], "pony", "#e0a96d", "#43a047", "#5d4037", arms="up", face="laugh"))
    # Seilspringen Vordergrund links
    b.append('<path d="M60 470 Q150 545 240 470" stroke="#ab47bc" stroke-width="3" fill="none"/>')
    b.append(person(45, 500, 1.15, SKIN[2], "braids", "#212121", "#ff7043", "#1565c0", kind="pants", arms="forward"))
    b.append(person(255, 500, 1.15, SKIN[0], "long", "#d4a017", "#26a69a", "#5d4037", kind="skirt", arms="out", face="laugh"))
    b.append(person(150, 495, 1.15, SKIN[1], "pony", "#6d3f1f", "#fdd835", "#e53935", kind="skirt", legs="jump", arms="up", face="laugh"))
    # Himmel und Hölle (Kreide)
    b.append('<g transform="translate(330,530) skewX(-20)" stroke="#fff" stroke-width="3" fill="none">'
             '<rect x="0" y="-30" width="40" height="30"/><rect x="40" y="-30" width="40" height="30"/><rect x="80" y="-30" width="40" height="30"/>'
             '<rect x="120" y="-50" width="40" height="30"/><rect x="120" y="-20" width="40" height="30" opacity="0"/>'
             '<path d="M160 -50 q30 10 0 30"/></g>'
             '<g font-size="16" fill="#fff" font-weight="700"><text x="335" y="522">1</text><text x="375" y="522">2</text><text x="415" y="522">3</text><text x="452" y="503">4</text></g>')
    # Bank mit Junge, der Brot isst
    b.append('<g><rect x="560" y="470" width="180" height="12" rx="3" fill="#8b5a2b"/><rect x="570" y="482" width="10" height="34" fill="#5d4037"/><rect x="720" y="482" width="10" height="34" fill="#5d4037"/>'
             '<rect x="560" y="440" width="180" height="10" rx="3" fill="#8b5a2b"/><rect x="580" y="450" width="8" height="20" fill="#5d4037"/><rect x="712" y="450" width="8" height="20" fill="#5d4037"/></g>')
    b.append(person(640, 514, 1.05, SKIN[0], "short", "#d84315", "#5c6bc0", "#37474f", legs="sit", arms="forward",
                    extra='<rect x="30" y="-76" width="18" height="12" rx="3" fill="#f5deb3" stroke="#c68a3e"/><path d="M31 -70 h16" stroke="#7cb342" stroke-width="2"/>'))
    b.append('<g transform="translate(695,462)"><rect x="-10" y="-22" width="22" height="22" rx="4" fill="#e53935"/></g>')  # Brotdose
    # Lehrerin mit Pfeife (Aufsicht)
    b.append(person(470, 430, 1.25, SKIN[1], "bun", "#5d4037", "#8e24aa", "#263238", arms="hips",
                    extra='<path d="M-5 -78 L0 -62 L5 -78" stroke="#9e9e9e" stroke-width="1.5" fill="none"/><rect x="-6" y="-63" width="13" height="6" rx="2" fill="#ffb300"/>'))
    save("schulhof.svg", "".join(b), "Auf dem Schulhof")


# ================================================================ BILD 5: Hafen (Klassenarbeit)
def bild_hafen():
    b = []
    b.append('<defs><linearGradient id="hsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcc80"/><stop offset="1" stop-color="#ffe9c7"/></linearGradient></defs>')
    b.append(f'<rect width="{W}" height="{H}" fill="url(#hsky)"/>')
    b.append('<circle cx="160" cy="150" r="46" fill="#ff8a50" opacity=".9"/>')
    b.append(gull(300, 80, 1.0) + gull(360, 110, 0.8) + gull(520, 70, 1.1))
    # Meer
    b.append('<path d="M0 230 H800 V420 H0 Z" fill="#3c7fb1"/>')
    b.append('<g stroke="#a7d3f2" stroke-width="2" opacity=".7" stroke-linecap="round"><path d="M40 260 h50 M200 300 h40 M120 360 h60 M450 280 h40 M330 390 h50"/></g>')
    # Felsen + Leuchtturm rechts
    b.append('<path d="M600 240 Q640 200 700 210 Q760 200 800 225 V300 H600 Z" fill="#6d6d6d"/>')
    b.append('<g><path d="M672 210 L680 80 H716 L724 210 Z" fill="#fff"/>'
             '<path d="M678 112 H718 L720 140 H676 Z M674 168 H722 L723 196 H673 Z" fill="#e53935"/>'
             '<rect x="676" y="56" width="44" height="26" fill="#ffd23f" stroke="#37474f" stroke-width="3"/><path d="M670 56 L698 30 L726 56 Z" fill="#37474f"/>'
             '<path d="M676 69 L560 40 L560 100 Z" fill="#fff59d" opacity=".5"/></g>')
    # Segelboot fern
    b.append('<g transform="translate(470,250) scale(.6)"><path d="M-40 0 h80 l-12 14 h-56 z" fill="#fff"/><rect x="-2" y="-70" width="4" height="70" fill="#5d4037"/><path d="M4 -66 L36 -6 H4 Z" fill="#4fc3f7"/></g>')
    # Fischerboot Mittelgrund
    b.append('<g transform="translate(300,380)"><path d="M-150 -40 H150 L118 10 H-118 Z" fill="#1e88e5"/><path d="M-150 -40 H150 L146 -30 H-146 Z" fill="#fff"/>'
             '<rect x="20" y="-100" width="80" height="60" fill="#fff" stroke="#37474f" stroke-width="3"/><rect x="34" y="-88" width="22" height="20" fill="#90caf9"/><rect x="64" y="-88" width="22" height="20" fill="#90caf9"/>'
             '<rect x="-60" y="-160" width="6" height="120" fill="#5d4037"/><path d="M-57 -150 L60 -100" stroke="#5d4037" stroke-width="2"/>'
             '<path d="M-57 -150 L-130 -44" stroke="#5d4037" stroke-width="2"/>'
             '<text x="-90" y="-12" font-size="18" font-weight="800" fill="#fff">MÖWE 3</text>'
             '<circle cx="128" cy="-20" r="10" fill="none" stroke="#e53935" stroke-width="5"/></g>')
    # Kaimauer
    b.append('<path d="M0 420 H800 V560 H0 Z" fill="#a1887f"/><path d="M0 420 H800 V434 H0 Z" fill="#795548"/>')
    b.append("".join(f'<path d="M{x} 434 v126" stroke="#8d6e63" stroke-width="2"/>' for x in range(0, 800, 80)))
    # Poller + Tau
    b.append('<g><rect x="430" y="420" width="26" height="30" rx="4" fill="#37474f"/><rect x="424" y="414" width="38" height="10" rx="4" fill="#263238"/>'
             '<path d="M443 425 Q400 410 360 382" stroke="#d7b48a" stroke-width="4" fill="none"/></g>')
    # Fischer mit Kisten links
    b.append(person(120, 520, 1.35, SKIN[0], "cap:#263238", "#9e9e9e", "#fdd835", "#fdd835", arms="forward", beard="#bdbdbd",
                    extra=''))
    for i, (kx, ky) in enumerate([(170, 520), (230, 520), (200, 490)]):
        b.append(f'<g><rect x="{kx}" y="{ky - 30}" width="56" height="30" fill="#29b6f6" stroke="#0277bd" stroke-width="2"/>'
                 + "".join(f'<path d="M{kx + 8 + j * 12} {ky - 30} q6 -8 12 0 l3 -4 v8 l-3 -4 q-6 8 -12 0" fill="#b0bec5" stroke="#78909c"/>' for j in range(3)) + '</g>')
    # Anker
    b.append('<g transform="translate(330,530)" stroke="#455a64" stroke-width="7" fill="none" stroke-linecap="round"><circle cx="0" cy="-58" r="8"/><path d="M0 -50 V0 M-16 -38 H16 M-28 -16 Q-22 6 0 0 Q22 6 28 -16"/></g>')
    # Kind füttert Möwen rechts
    b.append(person(640, 525, 1.2, SKIN[3], "curly", "#111", "#e53935", "#1565c0", kind="shorts", arms="wave"))
    b.append('<g transform="translate(705,455)"><ellipse cx="0" cy="0" rx="18" ry="10" fill="#fff" stroke="#b0bec5"/><circle cx="16" cy="-8" r="7" fill="#fff" stroke="#b0bec5"/>'
             '<path d="M22 -8 l8 2 l-8 2 z" fill="#ffb300"/><path d="M-18 -2 l-10 -4 l8 8 z" fill="#78909c"/><path d="M-4 9 v8 M4 9 v8" stroke="#ffb300" stroke-width="2"/></g>')
    b.append(gull(690, 360, 1.2))
    b.append('<circle cx="672" cy="390" r="3" fill="#c68a3e"/><circle cx="680" cy="404" r="3" fill="#c68a3e"/>')
    # Hund an der Leine? -> nein, Katze auf Kiste
    b.append(cat(560, 520, 0.9, "#ff9800"))
    save("im-hafen.svg", "".join(b), "Im Hafen")


# ================================================================ Maskottchen Lupo
def lupo():
    b = ('<g transform="translate(100,110)">'
         '<ellipse cx="0" cy="10" rx="58" ry="66" fill="#8d6e63"/><ellipse cx="0" cy="26" rx="38" ry="46" fill="#d7ccc8"/>'
         + "".join(f'<path d="M{x} {y} q6 6 12 0" stroke="#a1887f" stroke-width="2.5" fill="none"/>' for x, y in [(-18, 12), (2, 12), (-8, 28), (-24, 40), (8, 40), (-8, 54)]) +
         '<path d="M-50 -40 L-36 -76 L-20 -48 Z M50 -40 L36 -76 L20 -48 Z" fill="#6d4c41"/>'
         '<circle cx="-22" cy="-30" r="22" fill="#fff"/><circle cx="22" cy="-30" r="22" fill="#fff"/>'
         '<circle cx="-20" cy="-28" r="10" fill="#3e2723"/><circle cx="24" cy="-28" r="10" fill="#3e2723"/>'
         '<circle cx="-16" cy="-32" r="3.5" fill="#fff"/><circle cx="28" cy="-32" r="3.5" fill="#fff"/>'
         '<path d="M-6 -14 L0 -2 L6 -14 Z" fill="#ffb300"/>'
         '<path d="M-56 10 q-22 18 -10 46 q10 -20 20 -24 z" fill="#6d4c41"/>'
         '<path d="M-14 76 v8 M-8 76 v8 M8 76 v8 M14 76 v8" stroke="#ffb300" stroke-width="4" stroke-linecap="round"/>'
         # Lupe in rechtem Flügel
         '<path d="M54 10 q22 4 30 -14" stroke="#6d4c41" stroke-width="16" fill="none" stroke-linecap="round"/>'
         '<path d="M84 -8 L96 -34" stroke="#5d4037" stroke-width="8" stroke-linecap="round"/>'
         '<circle cx="104" cy="-54" r="22" fill="#e3f2fd" fill-opacity=".7" stroke="#ffb300" stroke-width="6"/>'
         '<path d="M94 -62 q6 -8 14 -6" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>'
         # Detektivmütze
         '<path d="M-44 -50 Q0 -96 44 -50 Q0 -62 -44 -50 Z" fill="#558b2f"/><path d="M-44 -50 Q0 -62 44 -50" stroke="#33691e" stroke-width="3" fill="none"/>'
         '<circle cx="0" cy="-80" r="5" fill="#33691e"/>'
         '</g>')
    save("lupo.svg", b, "Lupo, der Bilddetektiv", 240, 200)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    bild_see()
    bild_zimmer("a")
    bild_zimmer("b")
    bild_markt()
    bild_schulhof()
    bild_hafen()
    lupo()
    print("ok")
