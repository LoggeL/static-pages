"""Refresh the runtime inventory without probing nonexistent GLBs in the browser."""
import json
from pathlib import Path

world = Path(__file__).resolve().parent
props = sorted(path.stem for path in (world.parents[1] / 'models/props').glob('*.glb'))
(world / 'available-props.js').write_text(
    '// Generated from models/props/*.glb. Regenerate after adding or removing assets.\n'
    '// python3 public/bodycam-demo/js/world/refresh-props.py\n'
    f'export const AVAILABLE_PROPS = new Set({json.dumps(props, indent=2)});\n'
)
print(f'Indexed {len(props)} prop GLBs.')
