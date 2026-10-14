# UNIT 27 · Bodycam-Tech-Demo — Spielercharakter (Polizist mit Plattenträger)
# Aufruf (headless):  blender -b -P character.py -- <stage> [args]
#   Stages in Reihenfolge: prep, rig, garments, gear, materials, bake, assemble, export, all
# Zwischenstände: $BODYCAM_SCRATCH/character/stages/<stage>.blend (default: bodycam-work/codex/C10)
# Ergebnis: $BODYCAM_SCRATCH/blend/officer.blend und public/bodycam-demo/models/officer.glb
# Fortsetzen ab vorhandener gear.blend: -- materials,bake,assemble,export,qualification
# Dasselbe als Kurzform: -- finish (ursprüngliche Stages werden bei Bedarf lesend übernommen)
import sys, os, importlib, time, shutil
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
stage = argv[0] if argv else 'all'
ORDER = ['prep', 'rig', 'garments', 'gear', 'materials', 'bake', 'assemble', 'export']
stages = ORDER if stage == 'all' else ORDER[4:] + ['qualification'] if stage == 'finish' else stage.split(',')
for s in stages:
    if s not in ORDER + ['qualification', 'posetest']:
        raise SystemExit(f'Unknown character stage: {s}')
    t = time.time()
    mod = importlib.import_module('character_lib.' + s)
    print(f'==== STAGE {s} ====')
    mod.run(argv[1:])
    print(f'==== STAGE {s} done in {time.time()-t:.1f}s ====')
if stage == 'finish':
    from character_lib.common import CHARDIR
    from character_lib.settings import DEPLOY
    shutil.copy2(os.path.join(CHARDIR, 'qa/poses.json'), DEPLOY / '_dev/character/poses.json')
