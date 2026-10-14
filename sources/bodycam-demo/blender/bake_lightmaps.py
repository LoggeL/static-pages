"""C6: assemble, pack, Cycles/Metal bake, OIDN, RGBM and glTF export.

blender -b --python-exit-code 1 -P sources/bodycam-demo/blender/bake_lightmaps.py --
Intermediate artifacts stay in --work (outside the repository). No other component is modified.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

import bpy
import bmesh
import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
PUBLIC = REPO / 'public/bodycam-demo'
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
from bake_scene import (import_props, make_decals, prepare_runtime_materials, make_bake_material,
                        setup_lights, join_atlases, select, separate_surfaces, prepare_vertex_colors)
from bake_image import LightmapDenoiser, encode_rgbm, write_png
from bake_uv import ensure_chart_footprint


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def input_hashes(shell, config_path):
    paths = [shell, config_path, HERE / 'layout.json', PUBLIC / 'textures/index.json',
             PUBLIC / 'js/world/placement-config.json']
    paths += [HERE/name for name in ['bake_lightmaps.py','bake_scene.py','bake_image.py',
        'bake_png.py','bake_padding.py','bake_uv.py','bake_collision.py','bake_export.py']]
    paths += sorted((PUBLIC / 'models/props').glob('*.glb'))
    paths += sorted(p for p in (PUBLIC / 'textures').rglob('*') if p.suffix in ['.jpg', '.png', '.webp'])
    return {str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p): sha(p) for p in paths}


def cycles_setup(config):
    scene = bpy.context.scene; settings = config['bake']
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = settings['device']; prefs.get_devices()
    devices = []
    for device in prefs.devices:
        device.use = device.type == settings['device']
        if device.use: devices.append(device.name)
    if not devices: raise RuntimeError('No requested Cycles GPU available; refusing silent CPU fallback')
    scene.cycles.device = 'GPU'; scene.cycles.samples = settings['samples']
    scene.cycles.seed = settings['seed']; scene.cycles.use_animated_seed = False
    scene.cycles.max_bounces = settings['maxBounces']; scene.cycles.diffuse_bounces = settings['diffuseBounces']
    scene.cycles.transparent_max_bounces = settings['transparentBounces']
    scene.cycles.use_denoising = False  # Baking does not use the render denoiser. Explicit OIDN follows.
    scene.render.bake.margin = settings['paddingPixels']; scene.render.bake.margin_type = 'EXTEND'
    scene.render.bake.use_clear = True; scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_pass_color = False
    scene.render.bake.use_pass_direct = scene.render.bake.use_pass_indirect = True
    return devices


def pack_atlas(obj, settings):
    select([obj]); mesh = obj.data
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method='BEAUTY', ngon_method='BEAUTY')
    bad = [face for face in bm.faces if face.calc_area() < 1e-10]
    removed = len(bad)
    bmesh.ops.delete(bm, geom=bad, context='FACES_ONLY')
    for face in bm.faces: face.hide_set(False)
    bm.to_mesh(mesh); bm.free()
    mesh.uv_layers.new(name='Lightmap')
    mesh.uv_layers.active_index = 1
    mesh.uv_layers[0].active_render = True
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(settings['smartAngleDegrees']),
        island_margin=settings['islandGapPixels'] / (2 * settings['atlasSize']),
        margin_method='FRACTION', area_weight=0, correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    footprint = ensure_chart_footprint(obj, settings)
    # Reserve the outer eight pixels too, so clamp filtering never reaches another edge.
    uv = np.empty(len(mesh.loops) * 2, np.float32)
    mesh.uv_layers[1].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    border = settings['paddingPixels'] / settings['atlasSize']
    uv[:] = uv * (1 - 2 * border) + border
    mesh.uv_layers[1].data.foreach_set('uv', uv.ravel())
    if not np.isfinite(uv).all() or uv.min() < 0 or uv.max() > 1:
        raise ValueError(f'Invalid UV1 in {obj.name}: min={uv.min()} max={uv.max()} nonfinite={np.count_nonzero(~np.isfinite(uv))}')
    mesh.calc_loop_triangles()
    return {'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles),
            'materials': len(mesh.materials), **footprint, 'removedZeroAreaFaces': removed, 'uvMin': float(uv.min()), 'uvMax': float(uv.max())}


def prepare(args, layout, config, hashes, placement):
    started = time.monotonic()
    bpy.ops.wm.open_mainfile(filepath=str(args.shell))
    bpy.context.preferences.filepaths.save_version = 0
    shell_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    props, missing = import_props(layout, PUBLIC, placement)
    print(f'C6_ASSEMBLED {len(props)} present, {len(missing)} missing', flush=True)
    from bake_collision import build_collision
    collision = build_collision(shell_objects, props, layout, args.work / 'raw/house_collision.glb')
    # The collision collection must never take part in optical light transport.
    shell_names = set(o.name for o in shell_objects)
    prop_names = {o.name for p in props for o in p['objects']}
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and obj.name not in shell_names | prop_names:
            bpy.data.objects.remove(obj, do_unlink=True)
    decals = make_decals(layout, PUBLIC, config)
    objects = shell_objects + [o for p in props for o in p['objects']] + decals
    vertex_colors = prepare_vertex_colors(objects)
    prepare_runtime_materials(objects, config, json.loads((PUBLIC / 'textures/index.json').read_text()))
    records = setup_lights(layout, config)
    atlases = join_atlases(objects, layout)
    info = {}
    for key, obj in atlases.items():
        t0 = time.monotonic()
        obj.visible_shadow = True
        info[key] = pack_atlas(obj, config['bake'])
        print(f'C6_PACK {key}: {info[key]}, {time.monotonic()-t0:.2f}s', flush=True)
    for obj in bpy.context.scene.objects:
        if obj.name.startswith('DOOR_'):
            obj['dynamic'] = True; obj['lightmapExcluded'] = True
            # Closed/open doors cannot leave baked shadows on static walls.
            obj.hide_render = not config['bake']['doorsCastBakedShadows']
    devices = cycles_setup(config)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.work / 'blend/assembled.blend'), compress=True)
    report = {'inputHashes': hashes, 'config': config, 'device': devices, 'atlases': info,
        'collision': collision, 'missingProps': missing, 'propInstances': len(props), 'decals': len(decals),
        'vertexColors': vertex_colors,
        'propPlacements': [{'room': p['room'], 'name': p['definition']['name'], 'prop': p['definition']['prop'],
            'position': vec(p['definition']['pos']), 'rotationYDegrees': p['definition']['rotZ'],
            'anchor': p['definition'].get('anchor', 'source asset origin'), 'scale': [1, 1, 1]} for p in props],
        'placementConfig': placement,
        'lightsBlender': records, 'sceneSHA256': sha(args.work/'blend/assembled.blend'), 'prepareSeconds': time.monotonic()-started}
    save_json(args.work / 'reports/prepare.json', report)
    return report


def bake(args, config, report):
    from bake_padding import fill_chart_coverage
    settings = config['bake']; size = settings['atlasSize']
    runtime = {}
    index = json.loads((PUBLIC / 'textures/index.json').read_text())
    atlases = {key: bpy.data.objects['ATLAS_' + key] for key in report['atlases']}
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH': continue
        if len(obj.data.color_attributes):
            obj.data.color_attributes.active_color_index = 0
            obj.data.color_attributes.render_color_index = 0
        for slot in obj.material_slots:
            mat = slot.material
            if mat not in runtime: runtime[mat] = make_bake_material(mat, PUBLIC, index)
            slot.material = runtime[mat]
    cycles_setup(config)
    denoise = LightmapDenoiser()
    atlas_results = {}
    total_start = time.monotonic()
    try:
        for key, obj in atlases.items():
            if args.only and key not in args.only.split(','): continue
            start = time.monotonic()
            image = bpy.data.images.new('C6_' + key, width=size, height=size, alpha=True, float_buffer=True)
            image.colorspace_settings.name = 'Non-Color'; image.generated_color = (0, 0, 0, 0)
            for mat in set(obj.data.materials):
                node = mat.node_tree.nodes['C6_BakeTarget']; node.image = image; mat.node_tree.nodes.active = node
            select([obj])
            print(f'C6_BAKE_START {key} {size}px {settings["samples"]} samples', flush=True)
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, uv_layer='Lightmap')
            transport_seconds = time.monotonic() - start
            pixels = np.empty(size * size * 4, dtype=np.float32); image.pixels.foreach_get(pixels)
            pixels = pixels.reshape(size, size, 4)
            if not np.isfinite(pixels).all(): raise ValueError(f'Nonfinite Cycles output for {key}')
            np.save(args.work / 'raw' / f'{key}-cycles.npy', pixels)
            padding_start = time.monotonic()
            padding_info = fill_chart_coverage(obj, pixels, settings['chartPadding'])
            padding_seconds = time.monotonic() - padding_start
            np.save(args.work / 'raw' / f'{key}-linear.npy', pixels)
            rgb = np.maximum(pixels[:, :, :3], 0)
            denoise_start = time.monotonic(); clean = denoise(rgb)
            # Preserve only original Cycles coverage plus the chart-bound sampling support.
            coverage = pixels[:, :, 3] > 0
            clean[~coverage] = 0
            np.save(args.work / 'raw' / f'{key}-denoised.npy', clean)
            rgba, value_range, stats = encode_rgbm(clean, settings['rgbmMinimumRange'],
                settings.get('rgbmColorBitsByAtlas',{}).get(key,settings['rgbmColorBits']),
                settings['rgbmMultiplierSteps'],settings['rgbmQuadraticAboveRange'])
            path = args.work / 'raw' / f'{key.lower()}.png'
            # Blender image memory is bottom-up; PNG rows are top-down.
            write_png(path, rgba[::-1])
            result = {'id': key, 'path': f'lightmaps/{key.lower()}.png', 'range': value_range,
                'width': size, 'height': size, 'bytes': path.stat().st_size,
                'transportSeconds': transport_seconds, 'denoiseEncodeSeconds': time.monotonic()-denoise_start,
                'chartPaddingSeconds':padding_seconds, 'chartPadding':padding_info,
                'totalSeconds': time.monotonic()-start, 'sceneSHA256': report.get('sceneSHA256'),
                'sha256':sha(path), 'coverageFraction': float(coverage.mean()), **stats}
            atlas_results[key] = result
            save_json(args.work / 'reports' / f'bake-{key}.json', result)
            print('C6_BAKE_DONE ' + json.dumps(result), flush=True)
            for mat in set(obj.data.materials): mat.node_tree.nodes['C6_BakeTarget'].image = None
            bpy.data.images.remove(image)
    finally:
        denoise.close()
    from bake_png import optimize_pngs
    optimization=optimize_pngs(args.work,atlas_results,settings['pngOptimization'])
    for key,info in optimization['atlases'].items():
        atlas_results[key].update(info)
        save_json(args.work/'reports'/f'bake-{key}.json',atlas_results[key])
    save_json(args.work / 'reports/bake-run.json', {'seconds': time.monotonic()-total_start,
        'pngOptimizationWallSeconds':optimization['seconds'],'atlases': atlas_results})
    # Reload clean material graph and deterministic atlas packing for export.
    bpy.ops.wm.open_mainfile(filepath=str(args.work / 'blend/assembled.blend'))
    return atlas_results


def vec(value): return [value[0], value[2], -value[1]]


def build_level(layout, config, report, maps, meshes):
    rooms = []
    for source in layout['rooms']:
        room = dict(source)
        if 'aabb' in room:
            a,b,c,d,e,f = room['aabb']; room['aabb'] = [a,c,-e,d,f,-b]
        if 'polygon' in room: room['polygon'] = [[x, -y] for x,y in room['polygon']]
        if 'rects' in room: room['rects'] = [[x0,-y1,x1,-y0] for x0,y0,x1,y1 in room['rects']]
        if 'floorZ' in room: room['floorY'] = room.pop('floorZ')
        if 'ceilingZ' in room: room['ceilingY'] = room.pop('ceilingZ')
        room['polygonPlane'] = 'XZ'; rooms.append(room)
    def anchor(source):
        value = {k:v for k,v in source.items() if k not in ['pos','rotZ']}
        value['position'] = vec(source['pos'])
        value['yawDeg'] = source.get('yawDeg', source.get('rotZ', 0))
        return value
    doors = []
    for source in layout['doors']:
        door = dict(source)
        door['position'] = vec(door.pop('center'))
        if 'hinge' in door: door['hinge'] = vec(door['hinge'])
        door['axis'] = 'z' if door['axis'] == 'y' else 'x'
        door['rotationUnits'] = 'degrees about +Y'
        doors.append(door)
    lights = []
    for source in report['lightsBlender']:
        light = dict(source)
        if 'position' in light: light['position'] = vec(light['position'])
        if 'direction' in light: light['direction'] = vec(light['direction'])
        light['runtimeEnabled'] = False  # Static contributions are already in the maps.
        lights.append(light)
    lights.append({'id':'police','type':'dynamic','baked':False,'runtimeEnabled':config['runtime']['dynamicPoliceLights'],
        'position':vec(layout['policeCar']['pos']), 'provider':'engine', 'note':'No police light was baked.'})
    spawn = anchor(layout['playerSpawn']); spawn['pitchDeg'] = config['runtime']['camera']['pitchDeg']
    return {
        'version': 1, 'coords': 'Three.js Y-up, metres', 'sourceLayout': 'sources/bodycam-demo/blender/layout.json',
        'model': 'models/house.glb', 'collisionModel':'models/house_collision.glb',
        'playerSpawn':spawn, 'npcs':[anchor(x) for x in layout['suspects']],
        'rooms':rooms, 'doors':doors, 'lights':lights, 'fog':config['runtime']['fog'],
        'background':config['runtime']['background'], 'camera':config['runtime']['camera'],
        'policeCar':anchor(layout['policeCar']),
        'lightmapEncoding': {'type':'RGBM','range':config['bake']['rgbmMinimumRange'], 'colorSpace':'linear',
            'texCoord':1, 'decode':'linearRGB = (R8,G8,B8)/255 * pow(A8/255, atlas.multiplierExponent) * atlas.range',
            'multiplierExponent':'See each atlas and mesh; exponent 2 preserves dark values in high-range atlases.',
            'filtering':'Decode exact PNG bytes to linear half-float before bilinear sampling; no mipmaps.',
            'three':{'channel':1,'flipY':False,'colorSpace':'NoColorSpace','lightmapIntensity':config['bake']['lightmapIntensity']},
            'bakeValue':'Diffuse direct + indirect without albedo (unit Lambertian outgoing radiance); multiply by pi for irradiance.'},
        'lightmaps':list(maps.values()), 'meshes':meshes, 'missingProps':report['missingProps'],
        'propInstances':report['propPlacements'], 'placementConfig':report['placementConfig'],
        'staticPropsIncluded':True, 'staticDecalsIncluded':True, 'staticDecalInstances':report['decals'],
        'dynamicDoors':{'baked':False,'castBakedShadows':config['bake']['doorsCastBakedShadows'],
            'note':'Engine supplies dynamic door illumination/shadows. Do not reinstantiate layout props or decals.'},
    }


def export(args, layout, config, report):
    import shutil
    if input_hashes(args.shell, args.config) != report['inputHashes']:
        raise ValueError('Inputs changed during the run; refusing to publish a mixed snapshot')
    maps = {key: json.loads((args.work / 'reports' / f'bake-{key}.json').read_text()) for key in report['atlases']}
    if any(m.get('sceneSHA256') != report.get('sceneSHA256') for m in maps.values()):
        raise ValueError('Atlas belongs to a different preparation; rerun the complete bake')
    for item in maps.values():
        image_path = args.work / 'raw' / Path(item['path']).name
        if image_path.stat().st_size != item['bytes'] or sha(image_path) != item['sha256']:
            raise ValueError(f'Atlas file changed after bake: {image_path}')
    if config['bake']['atlasSize'] != 2048: raise ValueError('Delivery requires 2048px atlases')
    total = sum(x['bytes'] for x in maps.values())
    if total > config['bake']['maxLightmapBytes']: raise RuntimeError(f'Lightmap budget exceeded: {total}')
    meshes = []
    for key in report['atlases']:
        obj = bpy.data.objects['ATLAS_' + key]; select([obj])
        before = set(bpy.data.objects)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')
        parts = [obj] + sorted(set(bpy.data.objects) - before, key=lambda x: x.name)
        for material_part in parts:
            if not len(material_part.data.polygons):
                bpy.data.objects.remove(material_part, do_unlink=True); continue
            mat = material_part.data.materials[0]
            surface_parts = separate_surfaces(material_part)
            for part, surface in surface_parts:
                suffix = f'__{surface}' if len(surface_parts) > 1 else ''
                part.name = f'LM_{key}_{mat.name}{suffix}'
                for extra in list(part.keys()): del part[extra]
                encoding = {'type':'RGBM','range':maps[key]['range'],'colorSpace':'linear','texCoord':1,
                            'multiplierExponent':maps[key]['multiplierExponent'],
                            'decode':'linearRGB = rgb * pow(alpha, multiplierExponent) * range'}
                metadata = {'room':key,'surface':surface, 'lightmap':maps[key]['path'],
                    'lightmapIntensity':config['bake']['lightmapIntensity'], 'lightmapEncoding':encoding}
                if mat.get('decal'): metadata['decal'] = True
                for name,value in metadata.items(): part[name] = value
                meshes.append({'name':part.name, **metadata})
    export_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in export_objects:
        obj.hide_render = False
        if obj.name.startswith('DOOR_'):
            obj['hinge'] = vec(list(obj['hinge']))
            obj['coordinateSystem'] = 'Three.js Y-up'
            obj['surface'] = 'wood'
    select(export_objects)
    path = args.work / 'raw/house-uncompressed.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
        export_extras=True, export_apply=True, export_texcoords=True, export_normals=True,
        export_materials='EXPORT', export_image_format='AUTO', export_animations=False,
        export_cameras=False, export_lights=False, export_yup=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    from bake_export import compress_house
    compression = compress_house(path, args.work/'raw/house.glb', args.work, PUBLIC, config['export'])
    path = args.work/'raw/house.glb'
    level = build_level(layout, config, report, maps, meshes)
    level['bake'] = {'renderer':'Cycles','device':report['device'],'samples':config['bake']['samples'],
        'denoiser':'OpenImageDenoise RT HDR', 'lightmapBytes':total, 'compression':compression,
        'transportSeconds':sum(m['transportSeconds'] for m in maps.values()),
        'denoiseEncodeSeconds':sum(m['denoiseEncodeSeconds'] for m in maps.values()),
        'chartPaddingSeconds':sum(m['chartPaddingSeconds'] for m in maps.values()),
        'pngOptimizationWallSeconds':json.loads((args.work/'reports/bake-run.json').read_text())['pngOptimizationWallSeconds']}
    save_json(args.work / 'raw/level.json', level)
    replacements = {item['path']:item['bytes'] for item in maps.values()}
    replacements.update({'models/house.glb':path.stat().st_size,
        'models/house_collision.glb':(args.work/'raw/house_collision.glb').stat().st_size,
        'data/level.json':(args.work/'raw/level.json').stat().st_size})
    other_bytes = sum(p.stat().st_size for p in PUBLIC.rglob('*') if p.is_file()
        and p.relative_to(PUBLIC).parts[0] not in ['audio', '_dev']
        and p.relative_to(PUBLIC).as_posix() not in replacements)
    deploy_bytes = other_bytes + sum(replacements.values())
    if deploy_bytes > config['export']['maxDeployBytes']:
        raise RuntimeError(f'Deploy budget exceeded before publication: {deploy_bytes} bytes; '
            f'{other_bytes} bytes belong to other files')
    # Publish only after all atlas results are present and the budget has passed.
    (PUBLIC / 'lightmaps').mkdir(parents=True, exist_ok=True)
    for item in maps.values(): shutil.copy2(args.work / 'raw' / Path(item['path']).name, PUBLIC / item['path'])
    for rel in ['models/house.glb','models/house_collision.glb','data/level.json']:
        target = PUBLIC / rel; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.work / 'raw' / target.name, target)
    save_json(args.work / 'reports/export.json', {'lightmapBytes':total,'meshes':len(meshes),
        'houseBytes':path.stat().st_size, 'collisionBytes':(PUBLIC/'models/house_collision.glb').stat().st_size,
        'atlases':len(maps), 'deployBytesExcludingAudioAndDev':deploy_bytes,
        'inputHashes':report['inputHashes'], 'level':level['bake']})
    print(f'C6_EXPORT {len(meshes)} static meshes, {len(maps)} atlases, {total} lightmap bytes', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, default=Path('/Users/logge/Documents/Projects/bodycam-work/codex/C6'))
    parser.add_argument('--shell', type=Path, default=Path('/Users/logge/Documents/Projects/bodycam-work/blend/house_shell.blend'))
    parser.add_argument('--config', type=Path, default=HERE / 'lighting_bake.json')
    parser.add_argument('--max-deploy-bytes', type=int, help='override publication budget excluding audio/ and _dev/')
    parser.add_argument('--stage', choices=['all','prepare','bake','export'], default='all')
    parser.add_argument('--only', help='comma separated atlas IDs for diagnosis; never publishes partial maps')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.work = args.work.resolve(); args.shell = args.shell.resolve(); args.config = args.config.resolve()
    if args.work.is_relative_to(REPO): raise ValueError('--work must be outside the repository')
    if args.only and args.stage != 'bake': raise ValueError('--only is only supported with --stage bake')
    for name in ['blend','raw','reports']: (args.work / name).mkdir(parents=True, exist_ok=True)
    config = json.loads(args.config.read_text()); layout = json.loads((HERE / 'layout.json').read_text())
    placement = json.loads((PUBLIC / 'js/world/placement-config.json').read_text())
    if placement.get('version') != 1 or not isinstance(placement.get('rotationsByPropDegrees'), dict):
        raise ValueError('Unsupported placement-config.json schema')
    if any(not isinstance(value, (int, float)) or not math.isfinite(value)
           for value in placement['rotationsByPropDegrees'].values()):
        raise ValueError('Placement rotation offsets must be finite degrees')
    if args.max_deploy_bytes is not None:
        if args.max_deploy_bytes <= 0: raise ValueError('--max-deploy-bytes must be positive')
        config['export']['maxDeployBytes'] = args.max_deploy_bytes
    if config['bake']['atlasSize'] != 2048: print('C6_DIAGNOSTIC non-delivery atlas size', flush=True)
    if not args.shell.exists():
        args.shell = args.work / 'blend/house_shell.blend'
        subprocess.run([bpy.app.binary_path,'-b','--python-exit-code','1','-P',str(HERE/'house_shell.py'),'--',
            '--blend',str(args.shell),'--layout',str(args.work/'raw/layout.generated.json')],check=True)
        if json.loads((args.work/'raw/layout.generated.json').read_text()) != layout:
            raise ValueError('Regenerated shell layout differs from contract input; update source layout first')
    hashes = input_hashes(args.shell, args.config)
    if args.stage in ['all','prepare']:
        report = prepare(args, layout, config, hashes, placement)
    else:
        report = json.loads((args.work / 'reports/prepare.json').read_text())
        if report['inputHashes'] != hashes or report['config'] != config:
            raise ValueError('Bake inputs changed since preparation; rerun --stage prepare or full command')
        if sha(args.work/'blend/assembled.blend') != report['sceneSHA256']:
            raise ValueError('Prepared scene changed on disk; rerun preparation')
        bpy.ops.wm.open_mainfile(filepath=str(args.work / 'blend/assembled.blend'))
    if args.stage in ['all','bake']: bake(args, config, report)
    if args.stage in ['all','export']: export(args, layout, config, report)


if __name__ == '__main__': main()
