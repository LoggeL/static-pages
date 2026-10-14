"""Technical export controls; source palette and garment geometry stay authoritative."""
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
DEPLOY = REPO / 'public/bodycam-demo'
ATLAS_SIZE = 2048
ATLAS_MARGIN = 8
BAKE_SAMPLES = 16
AO_DISTANCE = 0.12
MAX_GLB_BYTES = 12_000_000
ALBEDO_JPEG_QUALITY = 92
# Reduce dense subdivision before UV packing, while keeping hands more detailed.
DECIMATE = {'Shirt': 0.40, 'OFF_Head': 0.55, 'Glove_L': 0.65, 'Glove_R': 0.65,
            'Carrier_Front': 0.45, 'Carrier_Back': 0.45, 'Belt': 0.50,
            'Molle_Back': 0.50, 'Cable_coil': 0.65}
# Rigid panels and all attached equipment follow the same chest bone.
RIGID_BIND = {'front': 'Spine2', 'back': 'Spine2', 'hips': 'Hips'}
