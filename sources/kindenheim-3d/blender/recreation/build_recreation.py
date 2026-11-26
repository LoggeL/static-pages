#!/usr/bin/env python3
"""
Blender 5.2 builder for the Kindenheim recreation assets:
  - Fussballplatz (Sportplatz Andingstrasse: club house, terrace, goals, floodlights, dugouts, scoreboard)
  - Kinderspielplatz Neugasse (tower with slide, swings, rope pyramid, carousel, seesaw, spring riders, ...)

Outputs (public/assets/models/recreation/):
  20 model .glb files, `recreation_materials.glb` (shared-library PBR maps, see rec_materials.py)
  and `manifest.json`; plus blender/recreation/kindenheim_recreation.blend as an archive.

Coordinate contract (unchanged from v1):
  Blender local +X = East, +Y = North, +Z = Up; fronts face -Y.
  glTF export is Y-up -> three.js (+X East, +Y Up, +Z South = Blender -Y).
  Blender rot_z(+theta) == three.js rotation.y(+theta).

Run:
  python3 blender/recreation/generate_textures.py
  /opt/homebrew/bin/blender --background --python blender/recreation/build_recreation.py
  (optional: `-- --only playground_tower,park_bench` rebuilds single assets and patches the manifest)
"""

import json
import sys
import zlib
from pathlib import Path

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import rec_materials as RM  # noqa: E402
from rec_toolkit import Acc, build_mesh, clear_scene, count_tris, ensure_collection  # noqa: E402

PROJECT_ROOT = SCRIPT_DIR.parent.parent
GLB_OUT_DIR = PROJECT_ROOT / "public" / "assets" / "models" / "recreation"
BLEND_OUT = SCRIPT_DIR / "kindenheim_recreation.blend"
MANIFEST_OUT = GLB_OUT_DIR / "manifest.json"
LIB_GLB_NAME = "recreation_materials.glb"


class Model:
    """One exported asset: accumulators per material for the static part + optional pivoted children."""

    def __init__(self, key: str, lib: dict, prefix: str | None = None):
        self.key = key
        self.lib = lib
        self.prefix = prefix or key
        self.accs: dict[str, Acc] = {}
        self.children: list[tuple[str, tuple, dict[str, Acc]]] = []

    def _acc(self, store: dict, mat_key: str) -> Acc:
        if mat_key not in store:
            spec = RM.resolve_spec(mat_key, self.lib)
            store[mat_key] = Acc(mat_key, spec, seed=zlib.crc32(f"{self.key}/{mat_key}/{len(store)}".encode()))
        return store[mat_key]

    def a(self, mat_key: str) -> Acc:
        return self._acc(self.accs, mat_key)

    def child(self, name: str, origin):
        store: dict[str, Acc] = {}
        self.children.append((name, tuple(origin), store))
        model = self

        class _Child:
            def a(self, mat_key: str) -> Acc:
                return model._acc(store, mat_key)

        return _Child()

    def finish(self, collection) -> list:
        objs = []
        for mat_key, acc in self.accs.items():
            if not acc.faces:
                continue
            obj = build_mesh(f"{self.prefix}_{mat_key}", [(acc, RM.get_material(mat_key, acc.spec))])
            collection.objects.link(obj)
            objs.append(obj)
        for name, origin, store in self.children:
            parts = [(acc, RM.get_material(k, acc.spec)) for k, acc in store.items() if acc.faces]
            obj = build_mesh(name, parts, origin=origin)
            collection.objects.link(obj)
            objs.append(obj)
        return objs


def export_glb(path: Path, objects: list, image_format: str = "WEBP") -> None:
    """Draco-compressed geometry. `image_format="AUTO"` embeds source JPEG/PNG files byte-for-byte."""
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format=image_format,
        export_image_quality=80,
        export_extras=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=14,
        export_draco_color_quantization=10,
    )


def export_asset(model: Model, collection, manifest_entries: dict) -> None:
    objects = model.finish(collection)
    if not objects:
        raise RuntimeError(f"Asset '{model.key}' produced no geometry")
    glb_path = GLB_OUT_DIR / f"{model.key}.glb"
    export_glb(glb_path, objects)

    # three.js Y-up bounds: Blender (x, y, z) -> (x, z, -y)
    mins, maxs, tris = [1e9] * 3, [-1e9] * 3, 0
    for obj in objects:
        tris += count_tris(obj)
        mw = obj.matrix_world
        for v in obj.data.vertices:
            wp = mw @ v.co
            for i, c in enumerate((wp.x, wp.z, -wp.y)):
                mins[i] = min(mins[i], c)
                maxs[i] = max(maxs[i], c)
    manifest_entries[model.key] = {
        "glbPath": f"/assets/models/recreation/{model.key}.glb",
        "bounds": {
            "min": [round(v, 3) for v in mins],
            "max": [round(v, 3) for v in maxs],
            "size": [round(maxs[i] - mins[i], 3) for i in range(3)],
        },
        "triangles": tris,
        "fileSizeBytes": glb_path.stat().st_size,
    }
    print(f"  {model.key}.glb  {glb_path.stat().st_size / 1024:8.1f} KB  {tris:6d} tris  {len(objects)} objects")


def export_material_library(lib: dict, collection) -> dict:
    """One 1 m swatch per library material; src/recreation.ts binds these maps onto all models."""
    import bmesh

    objs = []
    ids = list(RM.LIB_MAPS.keys())
    for i, mid in enumerate(ids):
        mat = RM.build_library_material(lib, mid)
        objs.append(_swatch(f"LibSwatch_{mid}", mat, i, collection))
    extra_keys = ["mesh_steel"]  # chain-link of the TypeScript-built ball-stop fences
    for j, key in enumerate(extra_keys):
        mat = RM.build_extra_surface_material(key)
        objs.append(_swatch(f"LibSwatch_rec_{key}", mat, len(ids) + j, collection))
    path = GLB_OUT_DIR / LIB_GLB_NAME
    export_glb(path, objs, image_format="AUTO")
    _verify_library_bytes(path, lib)
    print(f"  {LIB_GLB_NAME}  {path.stat().st_size / 1024:8.1f} KB  ({len(objs)} materials)")
    return {
        "glbPath": f"/assets/models/recreation/{LIB_GLB_NAME}",
        "fileSizeBytes": path.stat().st_size,
        "materials": ids + [f"rec_{k}" for k in extra_keys],
    }


def _verify_library_bytes(glb_path: Path, lib: dict) -> None:
    """Every embedded shared-library image must be the unchanged library file (exact bytes)."""
    import struct

    data = glb_path.read_bytes()
    json_len = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    wrong = []
    for img in gltf.get("images", []):
        view = gltf["bufferViews"][img["bufferView"]]
        blob = data[bin_start + view.get("byteOffset", 0): bin_start + view.get("byteOffset", 0) + view["byteLength"]]
        name = img["name"]
        mid = next((m for m in sorted(RM.LIB_MAPS, key=len, reverse=True) if name.startswith(m + "_")), None)
        if mid is None or "extraFiles" in lib[mid]:
            continue
        kind = name[len(mid) + 1:]
        src = PROJECT_ROOT / lib[mid]["files"][kind]
        if src.stem != name or src.read_bytes() != blob:
            wrong.append(name)
    if wrong:
        raise RuntimeError(f"{glb_path.name}: embedded library images differ from blender/shared_textures: {wrong}")


def _glb_images(glb_path: Path):
    """Yields (image name, embedded bytes) of one GLB."""
    import struct

    data = glb_path.read_bytes()
    json_len = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    for img in gltf.get("images", []):
        if "bufferView" not in img:
            raise RuntimeError(f"{glb_path.name}: image '{img.get('name')}' is not embedded")
        view = gltf["bufferViews"][img["bufferView"]]
        off = bin_start + view.get("byteOffset", 0)
        yield img["name"], data[off: off + view["byteLength"]]


def _verify_unique_image_names() -> None:
    """src/sharedAssets.ts de-duplicates textures by image name: one name must always mean the same bytes."""
    import hashlib

    seen: dict[str, tuple[str, str]] = {}
    clashes = []
    for glb in sorted(GLB_OUT_DIR.glob("*.glb")):
        for name, blob in _glb_images(glb):
            digest = hashlib.sha1(blob).hexdigest()
            if name in seen and seen[name][0] != digest:
                clashes.append(f"'{name}': {seen[name][1]} vs {glb.name}")
            seen.setdefault(name, (digest, glb.name))
    if clashes:
        raise RuntimeError("recreation GLBs embed one image name with different bytes:\n  " + "\n  ".join(clashes))
    print(f"  image names verified: {len(seen)} unique names, identical bytes everywhere")


def _swatch(name: str, mat, index: int, collection):
    mesh = bpy.data.meshes.new(name)
    x = index * 1.2
    mesh.from_pydata([(x, 0, 0), (x + 1, 0, 0), (x + 1, 1, 0), (x, 1, 0)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", [0, 0, 1, 0, 1, 1, 0, 1])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))

    print("=== Building Kindenheim recreation assets (Blender %s) ===" % bpy.app.version_string)
    clear_scene()
    lib = RM.load_library()

    import rec_models_play as PLAY
    import rec_models_sport as SPORT

    builders = SPORT.BUILDERS + PLAY.BUILDERS
    keys = [k for k, _ in builders]
    if only is not None:
        unknown = only - set(keys) - {"materials"}
        if unknown:
            raise SystemExit(f"--only: unknown asset keys {sorted(unknown)}; valid: {keys + ['materials']}")

    manifest_models: dict = {}
    material_library = None
    if only is not None:
        if not MANIFEST_OUT.exists():
            raise SystemExit("--only needs an existing manifest.json (run a full build first)")
        prev = json.loads(MANIFEST_OUT.read_text())
        manifest_models = prev["models"]
        material_library = prev.get("materialLibrary")

    for idx, (key, fn) in enumerate(builders):
        if only is not None and key not in only:
            continue
        col = ensure_collection(key)
        model = Model(key, lib)
        fn(model)
        export_asset(model, col, manifest_models)
        for obj in col.objects:  # spread the archive .blend along X for inspection in the GUI
            obj.location.x += idx * 16.0

    if only is None or "materials" in only:
        material_library = export_material_library(lib, ensure_collection("material_library"))
    if material_library is None:
        raise SystemExit("manifest has no materialLibrary entry; run with `--only materials` or a full build")
    _verify_unique_image_names()

    if only is None:
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))

    ordered = {k: manifest_models[k] for k in keys if k in manifest_models}
    missing = [k for k in keys if k not in ordered]
    if missing:
        raise SystemExit(f"manifest would miss assets {missing}; run a full build")
    manifest = {
        "coordinateSystem": "Three.js Y-up meters (+X East, +Y Up, +Z South / Blender -Y)",
        "materialLibrary": material_library,
        "models": ordered,
    }
    MANIFEST_OUT.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    total = sum(m["fileSizeBytes"] for m in ordered.values()) + material_library["fileSizeBytes"]
    tris = sum(m["triangles"] for m in ordered.values())
    print(f"Wrote {MANIFEST_OUT} ({len(ordered)} models, {tris} tris, {total / 1e6:.2f} MB incl. material library)")


if __name__ == "__main__":
    main()
