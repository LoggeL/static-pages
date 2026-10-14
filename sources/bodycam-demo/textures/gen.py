#!/usr/bin/env python3
"""Rohbilder fuer die Bodycam-Texturen per Codex-Imagegen erzeugen.

Usage: python3 gen.py <rawdir> [id ...] [--jobs 2] [--model gpt-image-2] [--variant v1]
Prompt = prompts/<id>.txt + prompts/_suffix_tile.txt (bzw. _suffix_decal.txt fuer d_*).
Bereits vorhandene Rohbilder werden uebersprungen (Imagegen ueberschreibt nie).
"""
import argparse, os, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PROMPTS = os.path.join(HERE, 'prompts')
TOOL = '/Users/logge/.codex/skills/codex-imagegen-models/scripts/codex_images.py'


def all_ids():
    return sorted(f[:-4] for f in os.listdir(PROMPTS) if f.endswith('.txt') and not f.startswith('_'))


def build_prompt(pid):
    body = open(os.path.join(PROMPTS, pid + '.txt')).read().strip()
    suf = '_suffix_decal.txt' if pid.startswith('d_') else '_suffix_tile.txt'
    if os.path.exists(os.path.join(PROMPTS, '_suffix_' + pid + '.txt')):
        suf = '_suffix_' + pid + '.txt'  # Sonderfall (z. B. Decal am Bildrand)
    return body + '\n' + open(os.path.join(PROMPTS, suf)).read().strip() + '\n'


def gen(pid, rawdir, model, variant):
    out = os.path.join(rawdir, f'{pid}_{variant}.png')
    if os.path.exists(out):
        return pid, 'skip'
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as tf:
        tf.write(build_prompt(pid))
        pf = tf.name
    try:
        r = subprocess.run([sys.executable, TOOL, '--model', model, '--prompt-file', pf, '--size', '2048x2048',
                            '--quality', 'high', '--out', out], capture_output=True, text=True, timeout=600)
        ok = r.returncode == 0 and os.path.exists(out)
        return pid, 'ok' if ok else 'FAIL ' + (r.stderr or r.stdout)[-400:]
    except Exception as e:  # noqa
        return pid, 'FAIL ' + str(e)
    finally:
        os.unlink(pf)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('rawdir')
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--jobs', type=int, default=2)
    ap.add_argument('--model', default='gpt-image-2')
    ap.add_argument('--variant', default='v1')
    a = ap.parse_args()
    os.makedirs(a.rawdir, exist_ok=True)
    ids = a.ids or all_ids()
    with ThreadPoolExecutor(a.jobs) as ex:
        for pid, st in ex.map(lambda i: gen(i, a.rawdir, a.model, a.variant), ids):
            print(pid, st, flush=True)


if __name__ == '__main__':
    main()
