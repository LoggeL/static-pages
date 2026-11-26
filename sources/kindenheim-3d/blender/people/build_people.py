#!/usr/bin/env python3
"""
Builds the Kindenheim villagers + dog in Blender 5.2 and exports them for the runtime (src/pedestrians*.ts).

    /opt/homebrew/bin/blender --background --factory-startup --python blender/people/build_people.py

Output
- public/assets/models/people/people.glb   all figures (LOD0 + LOD1 per model) skinned to `PedRig`, the dog to `DogRig`
                                            (Draco; COLOR_0.r = colour slot / 15, COLOR_0.g = cavity shade)
- public/assets/models/people/manifest.json skeletons (bone heads in glTF metres), models, palettes, gait parameters
- blender/people/people.blend               the scene, for inspection

No textures: every surface takes its colour from a per-instance palette slot (people_geo.SLOT); the runtime material
adds fabric / skin response per slot. Animation is NOT authored here: the runtime bakes walk / idle / chat cycles
into a bone-matrix texture from the skeleton below (src/pedestriansAnim.ts), so gait speed can follow the
walking speed exactly (no foot sliding).
"""

import json
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import people_geo  # noqa: E402
import people_models  # noqa: E402

PROJECT = HERE.parent.parent
OUT_DIR = PROJECT / "public" / "assets" / "models" / "people"
GLB = OUT_DIR / "people.glb"
MANIFEST = OUT_DIR / "manifest.json"
BLEND = HERE / "people.blend"


def gl_to_bl(p):
    return Vector((p[0], -p[2], p[1]))


def make_armature(name, skeleton, col):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    col.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = {}
    for bname, parent, head, tail in skeleton:
        eb = data.edit_bones.new(bname)
        eb.head = gl_to_bl(head)
        eb.tail = gl_to_bl(tail)
        eb.use_deform = True
        ebs[bname] = eb
    for bname, parent, _, _ in skeleton:
        if parent is not None:
            ebs[bname].parent = ebs[parent]
            ebs[bname].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def make_mesh(name, geo, arm_obj, col, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata([gl_to_bl(p) for p in geo.v], [], geo.f)
    me.validate(clean_customdata=False)
    if len(me.vertices) != len(geo.v):
        raise RuntimeError(f"{name}: mesh validation changed the vertex count ({len(geo.v)} -> {len(me.vertices)})")
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    flat = []
    for slot, shade in zip(geo.slot, geo.shade):
        flat += [slot / people_geo.SLOT_MAX, shade, 0.0, 1.0]
    attr.data.foreach_set("color", flat)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    col.objects.link(obj)
    groups = {}
    for b in arm_obj.data.bones:
        groups[b.name] = obj.vertex_groups.new(name=b.name)
    for i, w in enumerate(geo.w):
        for bone, x in w.items():
            if bone not in groups:
                raise KeyError(f"{name}: weight for unknown bone {bone}")
            groups[bone].add([i], x, "REPLACE")
    obj.parent = arm_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    return obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    col = bpy.data.collections.new("People")
    scene.collection.children.link(col)
    material = bpy.data.materials.new("Ped_Material")
    material.use_nodes = True

    ped_rig = make_armature("PedRig", people_models.SKELETON, col)
    dog_rig = make_armature("DogRig", people_models.DOG_SKELETON, col)

    objs = [ped_rig, dog_rig]
    models_out = []
    for spec in people_models.MODELS:
        tris = []
        names = []
        for lod in (0, 1):
            geo = people_models.human(spec, lod)
            name = f"ped_{spec['name']}_LOD{lod}"
            objs.append(make_mesh(name, geo, ped_rig, col, material))
            tris.append(geo.tri_count())
            names.append(name)
        entry = {
            "name": spec["name"],
            "label": spec["label"],
            "sex": spec["sex"],
            "lod0": names[0],
            "lod1": names[1],
            "triangles": tris,
            "anim": spec["anim"],
            "scale": spec["scale"],
            "palettes": spec["palettes"],
            "link": spec.get("link", {}),
            "dog": bool(spec.get("dog", False)),
            "elderly": spec["anim"]["style"].startswith("elderly"),
        }
        models_out.append(entry)
        print(f"  {spec['name']}: LOD0 {tris[0]} tris, LOD1 {tris[1]} tris")

    dog_names = []
    dog_tris = []
    for lod in (0, 1):
        geo = people_models.dog(lod)
        name = f"dog_LOD{lod}"
        objs.append(make_mesh(name, geo, dog_rig, col, material))
        dog_names.append(name)
        dog_tris.append(geo.tri_count())
    print(f"  dog: LOD0 {dog_tris[0]} tris, LOD1 {dog_tris[1]} tris")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ped_rig
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
        export_apply=False,
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_attributes=False,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_materials="EXPORT",
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_color_quantization=10,
        export_draco_generic_quantization=12,
    )

    def skel_json(skeleton):
        return [{"name": n, "parent": p, "head": list(h), "tail": list(t)} for n, p, h, t in skeleton]

    manifest = {
        "version": 1,
        "generator": "blender/people/build_people.py",
        "glb": "people.glb",
        "coordinateFrame": "glTF model space: +X left, +Y up (0 = sole), +Z forward",
        "slotEncoding": {"attribute": "COLOR_0.r", "scale": people_geo.SLOT_MAX, "dynamicSlots": people_geo.SLOT_COUNT_DYNAMIC,
                         "names": people_geo.SLOT, "shade": "COLOR_0.g"},
        "skeleton": skel_json(people_models.SKELETON),
        "dogSkeleton": skel_json(people_models.DOG_SKELETON),
        "models": models_out,
        "dog": {
            "name": "dog",
            "lod0": dog_names[0],
            "lod1": dog_names[1],
            "triangles": dog_tris,
            "anim": people_models.DOG["anim"],
            "scale": people_models.DOG["scale"],
            "palettes": people_models.DOG["palettes"],
        },
    }
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n")
    size = GLB.stat().st_size
    print(f"Exported {GLB} ({size / 1e6:.2f} MB) + {MANIFEST.name}")


main()
