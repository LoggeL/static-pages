"""C17: nine missing props. Blender 5.2, metres, front -Y, glTF Y-up.

blender -b -P sources/bodycam-demo/blender/props_missing.py -- --preview
Optional: --only toilet,bathtub --work /absolute/scratch --samples 48 --resolution 640
No existing prop or source catalog is rewritten. Preview artifacts stay outside repo.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
import subprocess
import sys

sys.dont_write_bytecode = True

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector, noise

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OUT = REPO / 'public/bodycam-demo/models/props'
TEXTURES = REPO / 'public/bodycam-demo/textures'
DEFAULT_WORK = REPO.parent / 'bodycam-work/codex/C17'

# Existing geometry helpers only, not the kitchen generator's main()/file writes.
spec = importlib.util.spec_from_file_location('c17_geometry', HERE / 'props_kitchenbath_lib.py')
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)

# Art direction is intentionally adjustable here. Colors are linear RGB.
STYLE = dict(seed=17027, grime=0.70, floor_dirt=0.58, rust=0.78,
             porcelain_roughness=0.16, enamel_roughness=0.31,
             mirror_roughness=0.09, bark_roughness=0.94,
             tree_height=5.10, bush_height=1.05)
MATERIALS = {
    'porcelain': ((0.66, 0.64, 0.57), STYLE['porcelain_roughness'], 0),
    'enamel_white': ((0.59, 0.57, 0.49), STYLE['enamel_roughness'], 0),
    'plastic_almond': ((0.48, 0.43, 0.32), 0.43, 0),
    'rubber_black': ((0.018, 0.019, 0.017), 0.78, 0),
    'chrome_dull': ((0.52, 0.53, 0.51), 0.25, 1),
    'steel_dark': ((0.035, 0.033, 0.029), 0.56, 0.85),
    'copper_old': ((0.32, 0.15, 0.065), 0.48, 0.8),
    'rust_chips': ((0.17, 0.063, 0.021), 0.93, 0.25),
    'mineral_stain': ((0.30, 0.235, 0.14), 0.81, 0),
    'bark_dead': ((0.14, 0.097, 0.060), STYLE['bark_roughness'], 0),
    'wood_cut': ((0.31, 0.22, 0.13), 0.95, 0),
    'glass_dark': ((0.043, 0.049, 0.042), 0.18, 0.25),
}
geo.MATS.update(MATERIALS)
PARTS = []


def part(ob, surface='metal'):
    ob['surface'] = surface
    PARTS.append(ob)
    return ob


def box(name, dims, loc, mat='enamel_white', bevel=0.005, surface='metal', step=None):
    return part(geo.rbox(name, *dims, mat, loc=loc, r=bevel, seg=2, step=step), surface)


def cyl(name, radius, depth, loc, mat='chrome_dull', rot=(0, 0, 0), sides=24, bevel=0.002):
    return part(geo.cyl(name, radius, depth, mat, seg=sides, loc=loc, rot=rot, bevel=bevel))


def tube(name, points, radius, mat='chrome_dull', radii=None, sides=10, surface='metal'):
    return part(geo.tube_path(name, points, radius, mat, sides=sides, radii=radii), surface)


def ellipse(rx, ry, z, cy=0, n=40):
    return [(rx * math.cos(i * 2 * math.pi / n), cy + ry * math.sin(i * 2 * math.pi / n), z)
            for i in range(n)]


def shell(name, rings, mat='porcelain', caps=True):
    ob = geo.loft(name, rings, mat, cap_first=caps, cap_last=caps)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    return part(ob)


def handle(name, x, y, z, width=0.11):
    pts = [(x-width/2, y+0.018, z), (x-width/2, y, z),
           (x+width/2, y, z), (x+width/2, y+0.018, z)]
    return part(geo.pipe(name, pts, 0.006, 'chrome_dull', sides=8, bend=0.009, n=2))


def wear_patch(name, center, u, v, width, height, seed, mat='rust_chips'):
    """Small irregular flush chip, no transparent decal or embedded texture."""
    rng=random.Random(seed); c=Vector(center); u=Vector(u); v=Vector(v)
    vertices=[c]+[c+u*(math.cos(i*math.tau/9)*width*rng.uniform(.6,1))+
                    v*(math.sin(i*math.tau/9)*height*rng.uniform(.6,1)) for i in range(9)]
    me=bpy.data.meshes.new(name)
    me.from_pydata(vertices,[],[(0,i+1,(i+1)%9+1) for i in range(9)])
    ob=bpy.data.objects.new(name,me); geo.link(ob); me.materials.append(geo.get_mat(mat)); part(ob)


def appliance_wear(front):
    for i,(x,z) in enumerate([(-.29,.13),(.286,.16),(-.21,.11),(.29,.30),(-.29,.42)]):
        wear_patch('enamel_chip',(x,front,z),(1,0,0),(0,0,1),.012,.021,91+i)
    for i in range(4):
        wear_patch('side_chip',(.3455,-.20+i*.10,.12+i*.015),(0,1,0),(0,0,1),.014,.009,81+i)


def faucet(x, y, z):
    cyl('tap_base', 0.031, 0.009, (x, y, z+0.005))
    tube('tap_spout', [(x,y,z), (x,y,z+0.07), (x,y-0.028,z+0.10),
                      (x,y-0.095,z+0.10), (x,y-0.105,z+0.079)], 0.013)
    for dx in (-0.098, 0.098):
        cyl('tap_valve', 0.020, 0.025, (x+dx, y, z+0.014))
        box('tap_handle', (0.048,0.015,0.009), (x+dx,y,z+0.029), 'chrome_dull', 0.004)


def toilet():
    # Compact 64 cm footprint clears the north wall at y=8.0 in layout.json.
    shell('pedestal', [ellipse(*v) for v in [(.125,.205,0,-.075), (.135,.212,.027,-.075),
          (.115,.15,.06,-.07), (.095,.126,.19,-.06), (.12,.156,.30,-.06)]])
    shell('bowl', [ellipse(*v) for v in [(.105,.14,.17,-.073), (.145,.196,.25,-.073),
          (.181,.238,.355,-.073), (.181,.238,.382,-.073), (.158,.210,.384,-.073),
          (.135,.18,.348,-.073), (.08,.12,.27,-.073), (.031,.052,.245,-.045)]])
    # Full annular seat, with a visible bowl cavity, lid removed.
    shell('seat', [ellipse(*v) for v in [(.180,.236,.385,-.073), (.187,.243,.396,-.073),
          (.185,.241,.408,-.073), (.148,.198,.409,-.073), (.146,.196,.394,-.073),
          (.180,.236,.385,-.073)]], 'plastic_almond', caps=False)
    box('tank', (.370,.175,.338), (0,.229,.574), 'porcelain', .029, step=.065)
    box('tank_lid', (.380,.185,.026), (0,.2275,.747), 'porcelain', .009)
    box('flush_lever', (.054,.014,.014), (-.112,.132,.689), 'chrome_dull', .005)
    for x in (-.093,.093):
        cyl('floor_bolt', .013, .012, (x,-.082,.031), 'porcelain', sides=12)
        box('hinge', (.026,.044,.02), (x,.118,.413), 'chrome_dull', .003)
    tube('supply', [(-.09,.24,.03),(-.09,.24,.28),(-.08,.25,.43)], .007)
    shell('bowl_minerals',[ellipse(.080,.120,.270,-.073),ellipse(.088,.131,.281,-.073)],
          'mineral_stain',caps=False)


def bathtub():
    # Five-foot alcove tub. Long axis X, open bathing well with real wall thickness.
    rings = [geo.rrect(0,0,hx,hy,r,z,nc=7) for hx,hy,r,z in [
        (.748,.368,.06,0),(.760,.380,.065,.045),(.760,.380,.065,.465),
        (.754,.374,.07,.500),(.651,.295,.17,.500),(.630,.272,.17,.467),
        (.56,.216,.16,.15),(.51,.180,.14,.115)]]
    shell('tub', rings, 'enamel_white')
    cyl('drain', .027, .005, (.45,0,.119), sides=24)
    for i in range(6):
        a=i*math.tau/6
        cyl('drain_slot', .003, .001, (.45+.013*math.cos(a),.013*math.sin(a),.122),
            'steel_dark', sides=6, bevel=0)
    cyl('overflow', .033, .006, (.642,0,.403), rot=(0,90,0))
    for x in (-.48,-.12,.30):
        box('apron_chip', (.025,.001,.007), (x,-.3805,.066), 'rust_chips', .001)
    for i in range(8):
        wear_patch('apron_rust',(-.62+i*.16,-.3806,.09+.025*math.sin(i)),(1,0,0),(0,0,1),
                   .023,.012,20+i)
    shell('drain_deposit',[ellipse(.042,.042,.120,n=32),ellipse(.030,.030,.1205,n=32)],
          'mineral_stain',caps=False)
    geo.place(PARTS[-1],loc=(.45,0,0))


def vanity():
    box('toe_kick', (.736,.42,.095), (0,.025,.0475), 'cabinet_wood', .008, 'wood')
    for x in (-.385,.385):
        box('cabinet_side', (.024,.478,.699), (x,0,.4415), 'cabinet_wood', .005, 'wood', step=.12)
    box('cabinet_back',(.746,.016,.699),(0,.231,.4415),'cabinet_wood',.003,'wood')
    box('cabinet_floor',(.746,.44,.024),(0,0,.105),'cabinet_wood',.003,'wood')
    box('cabinet_top_rail',(.794,.024,.060),(0,-.227,.772),'cabinet_wood',.004,'wood')
    for x in (-.20,.20):
        box('door_frame', (.388,.018,.62), (x,-.247,.445), 'cabinet_wood', .005, 'wood')
        box('door_panel', (.293,.01,.515), (x,-.260,.445), 'cabinet_wood', .006, 'wood')
        handle('cabinet_pull', x+(.125 if x<0 else -.125), -.280, .60, .062)
    # Ring topology gives an integrated sink without an intersecting solid countertop.
    rings = [geo.rrect(0,0,.410,.250,.035,.802,nc=9),
             geo.rrect(0,0,.410,.250,.035,.834,nc=9),
             geo.rrect(0,0,.402,.242,.035,.840,nc=9)]
    angles=[math.atan2(p[1]/.242,p[0]/.402) for p in rings[-1]]
    for rx,ry,z,cy in [(.260,.186,.840,-.032),(.248,.174,.817,-.032),
                       (.182,.125,.728,-.030),(.049,.045,.705,-.015),(.001,.001,.704,-.015)]:
        rings.append([(rx*math.cos(a),cy+ry*math.sin(a),z) for a in angles])
    # Leave the hidden underside open; the cabinet closes it visually and for collision.
    shell('sink_top', rings, caps=False)
    cyl('basin_drain', .026, .006, (0,-.015,.706))
    box('backsplash', (.82,.022,.085), (0,.238,.8635), 'porcelain', .008)
    faucet(0,.165,.842)
    for i in range(4):
        wear_patch('sink_deposit',(-.03+i*.019,-.06,.707),(1,0,0),(0,1,0),.011,.007,30+i,'mineral_stain')


def mirror():
    # Wall mount origin: lower middle of back plane, y=0; depth extends toward -Y.
    box('cabinet_case', (.60,.115,.75), (0,-.0575,.375), 'enamel_white', .006)
    box('door_gasket', (.570,.008,.714), (0,-.118,.375), 'rubber_black', .005)
    box('mirror_frame', (.578,.012,.722), (0,-.124,.375), 'chrome_dull', .006)
    mat = bpy.data.materials.new('MU_mirror_glass')
    mat.use_nodes=True
    bsdf=mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value=(.78,.80,.76,1)
    bsdf.inputs['Metallic'].default_value=1
    bsdf.inputs['Roughness'].default_value=STYLE['mirror_roughness']
    mat['surface']='glass'
    ob=box('mirror_glass',(.539,.002,.680),(0,-.131,.375),'chrome_dull',.001,'glass')
    ob.data.materials.clear(); ob.data.materials.append(mat)
    # Slim folded edge pull, inside the nominal depth.
    box('edge_pull',(.025,.013,.055),(.274,-.125,.16),'chrome_dull',.002)


def appliance_base(depth=.685):
    for x in (-.285,.285):
        for y in (-.275,.275):
            cyl('levelling_foot', .024, .035, (x,y,.0175), 'rubber_black', sides=12)
    box('cabinet',(.69,depth,.835),(0,0,.4525),'enamel_white',.012,step=.13)
    box('lower_seam',(.66,.003,.008),(0,-depth/2-.0015,.097),'steel_dark',.001)
    box('control_base',(.685,.122,.168),(0,.273, .984),'enamel_white',.013)
    box('control_panel',(.643,.009,.115),(0,.206,.996),'steel_dark',.008)


def dial(x, z, radius=.026):
    cyl('selector',radius,.019,(x,.195,z),'plastic_almond',rot=(90,0,0),sides=20)
    box('pointer',(.003,.002,.014),(x,.184,z+.003),'steel_dark',.001)
    for i in range(9):
        a=math.radians(-130+i*32.5)
        box('dial_tick',(.003,.001,.004),(x+math.sin(a)*(radius+.012),.200,
            z+math.cos(a)*(radius+.012)),'plastic_almond',.0004)


def washer():
    appliance_base()
    box('top_lip',(.69,.70,.028),(0,0,.884),'enamel_white',.008)
    box('lid_gap',(.55,.509,.004),(0,-.058,.900),'rubber_black',.012)
    box('top_lid',(.537,.496,.011),(0,-.058,.9055),'enamel_white',.012,step=.10)
    box('lid_recess',(.128,.021,.004),(0,-.271,.912),'steel_dark',.006)
    box('lid_grip',(.105,.018,.006),(0,-.28,.915),'plastic_almond',.004)
    dial(.18,1.006,.031)
    dial(-.20,1.005,.021); dial(-.075,1.005,.021)
    appliance_wear(-.3431)


def dryer():
    appliance_base(depth=.624)
    box('top',(.69,.695,.031),(0,0,.8855),'enamel_white',.009)
    # Period-appropriate solid front-loading door (not a contemporary glass porthole).
    box('door_gasket',(.520,.007,.544),(0,-.315,.489),'rubber_black',.028)
    box('door',(.509,.021,.533),(0,-.326,.489),'enamel_white',.025,step=.105)
    handle('door_pull',.165,-.344,.645,.075)
    for z in (.305,.662):
        box('hinge',(.023,.028,.033),(-.267,-.316,z),'chrome_dull',.003)
    for z in (.168,.187,.206):
        box('vent_slot',(.29,.002,.006),(0,-.313,z),'steel_dark',.002)
    box('lint_filter',(.23,.015,.004),(-.095,.13,.903),'plastic_almond',.004)
    dial(.18,1.006,.031); dial(-.18,1.005,.024)
    cyl('start',.014,.007,(-.047,.198,1.005),'plastic_almond',rot=(90,0,0),sides=12)
    appliance_wear(-.3131)


def water_heater():
    cyl('base',.270,.055,(0,0,.0275),'steel_dark',sides=40,bevel=.008)
    ob=shell('enamel_tank',[ellipse(r,r,z,n=48) for r,z in [
        (.26,.043),(.270,.065),(.270,1.342),(.255,1.38)]],'enamel_white')
    for z in (.09,1.335):
        shell('tank_seam',[ellipse(r,r,h,n=48) for r,h in [(.271,z),(.272,z+.005),
              (.271,z+.011)]],'chrome_dull',caps=False)
    box('service_panel',(.183,.019,.233),(0,-.258,.249),'enamel_white',.009,step=.06)
    for x in (-.076,.076):
        cyl('service_screw',.004,.004,(x,-.27,.334),'chrome_dull',rot=(90,0,0),sides=8,bevel=0)
    for x in (-.12,.12):
        cyl('pipe_collar',.027,.012,(x,0,1.383),'chrome_dull',sides=16)
        tube('water_pipe',[(x,0,1.38),(x,0,1.47),(x,.09,1.485)],.013,'copper_old')
    cyl('relief_valve',.021,.053,(.266,0,1.205),'copper_old',rot=(0,90,0),sides=12)
    tube('relief_pipe',[(.286,0,1.20),(.300,0,1.16),(.300,0,.19)],.010,'copper_old')
    cyl('drain_valve',.020,.04,(0,-.274,.124),'copper_old',rot=(90,0,0),sides=12)
    box('drain_handle',(.056,.013,.009),(0,-.292,.146),'steel_dark',.003)
    for i in range(9):
        a=-math.pi/2+i*.16-.64
        wear_patch('tank_rust',(.2707*math.cos(a),.2707*math.sin(a),.115+i*.008),
                   (-math.sin(a),math.cos(a),0),(0,0,1),.014,.030,50+i)


def branch(name, points, radii, sides=8):
    ob=tube(name,points,radii[0],'bark_dead',radii=radii,sides=sides,surface='wood')
    # Geometry relief and longitudinal UVs: continuous bark, no plank seams.
    geo.box_uv(ob)  # planar end caps; overwrite side faces with cylindrical metres below
    uv=ob.data.uv_layers.active
    n=len(points)
    distances=[0]
    for i in range(1,n): distances.append(distances[-1]+(Vector(points[i])-Vector(points[i-1])).length)
    for poly in ob.data.polygons:
        if len(poly.vertices)==4:
            indices=[v%sides for v in poly.vertices]
            wrap=max(indices)-min(indices)>sides/2
            for li in poly.loop_indices:
                vi=ob.data.loops[li].vertex_index; ring,k=divmod(vi,sides)
                u=(sides if wrap and k==0 else k)/sides
                uv.data[li].uv=(u*math.tau*radii[ring],distances[ring])
    ob['c17_bark_uv']=True
    for v in ob.data.vertices:
        ring,k=divmod(v.index,sides)
        center=Vector(points[ring]); radial=v.co-center
        v.co=center+radial*(1+.075*math.sin(k*math.pi*.92+ring*.4))
    return ob


def tree():
    rng=random.Random(STYLE['seed'])
    h=STYLE['tree_height']
    trunk=[(0,0,0),(.035,-.01,.45),(-.045,.02,1.25),(.055,.00,2.10),
           (.0,.10,3.05),(.11,.16,3.93),(.21,.07,4.62),(.12,.05,h)]
    branch('trunk',trunk,[.19,.165,.14,.12,.088,.053,.025,.008],sides=14)
    for i in range(7):
        a=i*math.tau/7+.2
        branch('root',[(.09*math.cos(a),.09*math.sin(a),.25),
            (.23*math.cos(a),.23*math.sin(a),.06),(.39*math.cos(a),.39*math.sin(a),.015)],
            [.08,.055,.013],8)
    for i in range(12):
        a=i*2.39996+rng.uniform(-.28,.28)
        z=1.42+i*.22
        length=1.55-(z-1.4)*.25+rng.uniform(-.12,.12)
        base=Vector((.02,.03,z)); direction=Vector((math.cos(a),math.sin(a),.44+rng.random()*.28))
        pts=[base,base+direction*length*.35,base+direction*length*.68+Vector((0,0,.10)),
             base+direction*length+Vector((-.10,.06,.30))]
        rad=.060-(i*.0027)
        branch('limb',[tuple(p) for p in pts],[rad,rad*.77,rad*.42,.0055],9)
        for j,t in enumerate((.40,.68,.85)):
            p=pts[1].lerp(pts[3],(t-.35)/.65)
            ang=a+(-1 if j%2 else 1)*(.5+rng.random()*.55)
            vec=Vector((math.cos(ang),math.sin(ang),.7))*(.38+rng.random()*.28)
            q=p+vec*.55; end=p+vec
            branch('twig',[tuple(p),tuple(q),tuple(end)],[.021,.012,.0028],6)
            spur=q+Vector((vec.y*.34,-vec.x*.34,.18))
            branch('twig_fork',[tuple(q),tuple(spur)],[.009,.002],5)
    plant_floor(h)


def bush():
    rng=random.Random(STYLE['seed']+1)
    h=STYLE['bush_height']
    for i in range(15):
        a=i*2.39996
        reach=.26+rng.random()*.32
        z=h*(.64+rng.random()*.32)
        p=Vector((.025*math.cos(a),.025*math.sin(a),.018))
        q=Vector((reach*.38*math.cos(a),reach*.38*math.sin(a),z*.48))
        r=Vector((reach*math.cos(a),reach*math.sin(a),z))
        branch('cane',[tuple(p),tuple(q),tuple(r)],[.021,.013,.0025],7)
        for j in range(3):
            base=q.lerp(r,.15+j*.25)
            angle=a+(.8 if j%2 else -.8)
            tip=base+Vector((math.cos(angle)*.17,math.sin(angle)*.17,.13))
            branch('bush_fork',[tuple(base),tuple(tip)],[.008,.0015],5)
    plant_floor(h)


def plant_floor(height):
    # Exact configured height and floor origin after the deterministic branching.
    zmin=min(v.co.z for o in PARTS for v in o.data.vertices)
    zmax=max(v.co.z for o in PARTS for v in o.data.vertices)
    for o in PARTS:
        for v in o.data.vertices: v.co.z=(v.co.z-zmin)*height/(zmax-zmin)


SPECS = {
    'toilet': (toilet,'metal','BATH','Compact US toilet; missing lid, annular seat, tank and supply.'),
    'bathtub': (bathtub,'metal','BATH','Five-foot alcove tub, open well, drain and overflow.'),
    'bath_vanity': (vanity,'wood','BATH','82 cm wood vanity; countertop 0.84 m, integrated basin and taps.'),
    'mirror_cabinet': (mirror,'metal','BATH','Wall back at Y=0, lower edge Z=0; opaque glass mirror.'),
    'washing_machine': (washer,'metal','UTIL','27-inch top loader, closed lid and mechanical controls.'),
    'dryer': (dryer,'metal','UTIL','27-inch front loader, solid enamel door, lint filter and vents.'),
    'water_heater': (water_heater,'metal','UTIL','Standing electric tank, two water pipes, relief and drain.'),
    'tree_dead': (tree,'wood','SITE','Bare branching tree with roots and longitudinal bark relief.'),
    'bush_dead': (bush,'wood','SITE','Brown leafless shrub, tapered canes and forks.'),
}


def finish(name):
    """UVs are metres; COLOR_0 contains deterministic grime and bark variation."""
    for o in PARTS:
        geo.apply_mods(o); geo.apply_tf(o)
        # Fully clamped bevels on thin plates can emit collapsed triangles.
        # Resolve topology before UVs/colors so all attribute indices remain aligned.
        bm=bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm,faces=list(bm.faces))
        collapsed=[f for f in bm.faces if (f.verts[1].co-f.verts[0].co).cross(
            f.verts[2].co-f.verts[0].co).length*.5<1e-12]
        if collapsed: bmesh.ops.delete(bm,geom=collapsed,context='FACES_ONLY')
        loose=[v for v in bm.verts if not v.link_faces]
        if loose: bmesh.ops.delete(bm,geom=loose,context='VERTS')
        bm.to_mesh(o.data); bm.free(); o.data.update()
        if not o.get('c17_bark_uv'): geo.box_uv(o)
        me=o.data
        me.shade_smooth(); me.set_sharp_from_angle(angle=math.radians(38))
        # Sharp edges plus weighted normals keep enamel panels planar.
        wn=o.modifiers.new('weighted_normal','WEIGHTED_NORMAL'); wn.keep_sharp=True
        geo.apply_mods(o); me=o.data
        colors=me.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
        me.color_attributes.active_color=colors
        for poly in me.polygons:
            key=me.materials[poly.material_index].name
            for li in poly.loop_indices:
                p=me.vertices[me.loops[li].vertex_index].co
                n=noise.noise(Vector((p.x*16+4,p.y*16+9,p.z*16+3)),noise_basis='PERLIN_ORIGINAL')*.5+.5
                streak=(.5+.5*math.sin(p.x*91+p.y*57+math.sin(p.z*9)*.8))**9
                floor=math.exp(-max(0,p.z)/.095)*STYLE['floor_dirt']
                amount=STYLE['grime']*(.16+.55*n+.6*streak)+floor
                if key=='M_bark_dead':
                    # Perimeter ridges remain readable at silhouette; no extra texture set.
                    idx=me.loops[li].vertex_index
                    shade=.52+.46*(.5+.5*math.cos(idx*2.1))+.10*n
                    rgb=(shade,shade*.95,shade*.86)
                elif key=='MU_mirror_glass':
                    edge=max(abs(p.x)/.27,abs(p.z-.375)/.34)
                    dirt=max(0,(edge-.78)/.22)*.50+.045*n
                    rgb=(1-dirt*.65,1-dirt*.71,1-dirt*.77)
                elif key in ('M_porcelain','M_enamel_white','M_plastic_almond'):
                    rust=STYLE['rust']*max(0,streak-.65)*math.exp(-max(0,p.z)/.19)
                    rgb=(1-amount*.45,1-amount*.59-rust*.25,1-amount*.74-rust*.4)
                else:
                    rgb=(1-amount*.28,1-amount*.32,1-amount*.37)
                colors.data[li].color=(*[max(.12,min(1,c)) for c in rgb],1)
    groups=[]
    surface_groups={surface:[o for o in PARTS if o['surface']==surface]
                    for surface in sorted({o['surface'] for o in PARTS})}
    for surface,obs in surface_groups.items():
        ob=geo.join(obs,f'{name}_{surface}')
        ob['surface']=surface
        for k in list(ob.keys()):
            if k!='surface': del ob[k]
        groups.append(ob)
    root=bpy.data.objects.new(name,None)
    bpy.context.scene.collection.objects.link(root)
    root['surface']=SPECS[name][1]
    for ob in groups: ob.parent=root
    coords=[v.co for o in groups for v in o.data.vertices]
    lo=[min(p[i] for p in coords) for i in range(3)]
    hi=[max(p[i] for p in coords) for i in range(3)]
    tris=sum(geo.tri_count(o) for o in groups)
    assert tris < (6000 if name in ('tree_dead','bush_dead') else 8000), (name,tris)
    assert abs(lo[2])<.003, (name,'floor',lo)
    materials=sorted({m.name for o in groups for m in o.data.materials})
    entry=dict(name=name,dims=[round(hi[i]-lo[i],4) for i in range(3)],surface=SPECS[name][1],
               materials=materials,roomHint=SPECS[name][2],notes=SPECS[name][3],tris=tris,
               bounds={'min':[round(x,5) for x in lo],'max':[round(x,5) for x in hi]},
               collision='render-mesh; assembly uses existing bake_collision proxy rules',generator='C17')
    if name=='mirror_cabinet': entry['mount']='Back plane Y=0; bottom at layout Z=1.75 m'
    return root,groups,entry


def export(root, groups, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root]+groups: o.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',use_selection=True,
        export_apply=True,export_extras=True,export_yup=True,export_normals=True,export_tangents=False,
        export_materials='EXPORT',export_vertex_color='ACTIVE',export_all_vertex_colors=False,
        export_animations=False,export_skins=False,export_morph=False,export_cameras=False,export_lights=False)


def update_catalog(entries):
    path=OUT/'catalog.json'
    if path.exists():
        old=path.read_text(); catalog=json.loads(old)
    else:
        # The public catalog was absent at C17 start. Copy existing fragments verbatim as objects.
        catalog=[]
        for p in sorted(HERE.glob('props_*.json')):
            fragment=json.loads(p.read_text())
            if not isinstance(fragment,list): raise ValueError(f'Unexpected catalog fragment: {p}')
            catalog.extend(fragment)
        old=json.dumps(catalog,indent=2,ensure_ascii=False)+'\n'
    by_name={e['name']:e for e in catalog}
    assert len(by_name)==len(catalog),'Duplicate existing catalog entries'
    append=[]
    for entry in entries:
        if entry['name'] in by_name:
            if entry!=by_name[entry['name']]:
                if by_name[entry['name']].get('generator')!='C17':
                    raise ValueError(f"Refusing to change existing catalog entry {entry['name']}")
                # Replace only this generator's object, retaining all other source bytes.
                decoder=json.JSONDecoder(); pos=old.index('[')+1
                while True:
                    while old[pos].isspace() or old[pos]==',': pos+=1
                    obj,end=decoder.raw_decode(old,pos)
                    if obj['name']==entry['name']:
                        old=old[:pos]+json.dumps(entry,ensure_ascii=False,indent=2).replace('\n','\n  ')+old[end:]
                        break
                    pos=end
        else: append.append(entry)
    if append:
        # Preserve existing bytes, whitespace and entries; append before the array close.
        end=old.rfind(']')
        prefix=old[:end].rstrip()
        addition=',\n' if catalog else '\n'
        addition+=',\n'.join('  '+json.dumps(e,ensure_ascii=False,indent=2).replace('\n','\n  ') for e in append)
        path.write_text(prefix+addition+'\n'+old[end:])
    else: path.write_text(old)


def preview(items,args):
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'; prefs.get_devices()
    for device in prefs.devices: device.use=device.type=='METAL'
    if not any(d.use for d in prefs.devices): raise RuntimeError('Metal device unavailable')
    scene.cycles.device='GPU'; scene.cycles.samples=args.samples; scene.cycles.use_denoising=True
    scene.render.resolution_x=scene.render.resolution_y=args.resolution
    scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('C17_studio'); world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.32,.37,.44,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.45
    scene.world=world
    # Apply the same external tiles as the browser only after all texture-free GLBs are exported.
    index=json.loads((TEXTURES/'index.json').read_text())
    for mat in list(bpy.data.materials):
        if not mat.use_nodes: continue
        nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF')
        tid=mat.name[2:] if mat.name.startswith('M_') else ''
        src=None
        if tid in index:
            tc=nt.nodes.new('ShaderNodeTexCoord'); mapping=nt.nodes.new('ShaderNodeVectorMath')
            mapping.operation='SCALE'; mapping.inputs[3].default_value=1/index[tid]['tileMeters']
            nt.links.new(tc.outputs['UV'],mapping.inputs[0])
            for channel in ('albedo','normal','orm'):
                tex=nt.nodes.new('ShaderNodeTexImage')
                tex.image=bpy.data.images.load(str(TEXTURES/tid/f'{channel}.jpg'),check_existing=True)
                if channel!='albedo': tex.image.colorspace_settings.name='Non-Color'
                nt.links.new(mapping.outputs[0],tex.inputs['Vector'])
                if channel=='albedo': src=tex.outputs['Color']
                elif channel=='normal':
                    nm=nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tex.outputs['Color'],nm.inputs['Color'])
                    nt.links.new(nm.outputs[0],bs.inputs['Normal'])
                else:
                    sep=nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(tex.outputs['Color'],sep.inputs[0])
                    nt.links.new(sep.outputs['Green'],bs.inputs['Roughness'])
                    nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
        col=nt.nodes.new('ShaderNodeVertexColor'); col.layer_name='Color'
        mix=nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1
        if src: nt.links.new(src,mix.inputs[1])
        else: mix.inputs[1].default_value=bs.inputs['Base Color'].default_value
        nt.links.new(col.outputs['Color'],mix.inputs[2]); nt.links.new(mix.outputs[0],bs.inputs['Base Color'])
    def aim(o,target): o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.003))
    floor=bpy.context.object
    fm=bpy.data.materials.new('studio_floor'); fm.diffuse_color=(.17,.19,.21,1); floor.data.materials.append(fm)
    lights=[]
    for name,energy,color in [('key',550,(1,.91,.80)),('fill',300,(.72,.82,1)),('rim',600,(1,.96,.9))]:
        data=bpy.data.lights.new(name,'AREA'); data.energy=energy; data.color=color; data.shape='DISK'
        ob=bpy.data.objects.new(name,data); scene.collection.objects.link(ob); lights.append(ob)
    data=bpy.data.cameras.new('camera'); data.type='ORTHO'
    camera=bpy.data.objects.new('camera',data); scene.collection.objects.link(camera); scene.camera=camera
    meta=[]
    for name,(root,groups,entry) in items.items():
        for _,(r,gs,e) in items.items():
            for o in gs: o.hide_render=r!=root
        lo=Vector(entry['bounds']['min']); hi=Vector(entry['bounds']['max']); center=(lo+hi)*.5
        size=max(entry['dims']); span=size*1.62
        data.ortho_scale=span
        camera.location=center+Vector((1.05,-1.65,1.05))*size*2
        aim(camera,center)
        for light,offset in zip(lights,[(2,-3,4),(-3,-1,2),(1,3,4)]):
            light.location=center+Vector(offset)*size
            light.data.energy={'key':550,'fill':300,'rim':600}[light.name]*size*size
            light.data.size=size*2; aim(light,center)
        path=args.work/f'{name}.png'; scene.render.filepath=str(path)
        bpy.ops.render.render(write_still=True)
        meta.append(dict(name=name,path=str(path),dims=entry['dims'],tris=entry['tris'],span=span))
    (args.work/'preview-meta.json').write_text(json.dumps(meta,indent=2))
    # Pillow is a build-time tool; no new game/runtime dependency or repo helper file.
    code='''import json,sys
from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
w=Path(sys.argv[1]); meta=json.loads((w/'preview-meta.json').read_text()); cell=640; footer=92
sheet=Image.new('RGB',(cell*3,(cell+footer)*3),(27,31,36)); d=ImageDraw.Draw(sheet)
try: font=ImageFont.truetype('/System/Library/Fonts/Menlo.ttc',18)
except OSError: font=ImageFont.load_default()
for i,m in enumerate(meta):
 x=i%3*cell; y=i//3*(cell+footer)
 sheet.paste(Image.open(m['path']).convert('RGB').resize((cell,cell)),(x,y))
 d.text((x+18,y+cell+10),m['name'],font=font,fill='white')
 dims=' x '.join(f'{v:.3f}' for v in m['dims'])+' m (X/Y/Z)'
 d.text((x+18,y+cell+36),dims,font=font,fill=(185,197,205))
 scale=1 if m['name']=='tree_dead' else .25; pixels=round(cell*scale/m['span'])
 sx=x+cell-24-pixels; sy=y+cell-25
 d.rectangle((sx-9,sy-26,x+cell-10,sy+12),fill=(27,31,36))
 d.line((sx,sy,sx+pixels,sy),fill='white',width=3)
 d.line((sx,sy-5,sx,sy+5),fill='white',width=2); d.line((sx+pixels,sy-5,sx+pixels,sy+5),fill='white',width=2)
 d.text((sx,sy-24),f'{scale:g} m',font=font,fill='white')
 d.text((x+18,y+cell+62),str(m['tris'])+' triangles',font=font,fill=(185,197,205))
sheet.save(w/'contact-sheet.png')
'''
    subprocess.run(['python3','-c',code,str(args.work)],check=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only',default=','.join(SPECS))
    parser.add_argument('--work',type=Path,default=DEFAULT_WORK)
    parser.add_argument('--preview',action='store_true')
    parser.add_argument('--samples',type=int,default=48)
    parser.add_argument('--resolution',type=int,default=640)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.work=args.work.resolve()
    if args.work.is_relative_to(REPO): raise ValueError('Preview/work directory must be outside repo')
    args.work.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
    names=args.only.split(',')
    if set(names)-set(SPECS): raise ValueError('Unknown --only prop')
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob,do_unlink=True)
    random.seed(STYLE['seed']); noise.seed_set(STYLE['seed'])
    items={}
    for name in names:
        PARTS.clear(); SPECS[name][0]()
        root,groups,entry=finish(name)
        export(root,groups,name)
        items[name]=(root,groups,entry)
        print('C17_PROP',name,entry['dims'],entry['tris'],flush=True)
    entries=[v[2] for v in items.values()]
    # Write the catalog only once all nine model budgets and origins pass.
    update_catalog(entries)
    report={'style':STYLE,'props':entries,'sha256':{name:hashlib.sha256((OUT/f'{name}.glb').read_bytes()).hexdigest() for name in names}}
    (args.work/'generation.json').write_text(json.dumps(report,indent=2))
    if args.preview: preview(items,args)
    print('C17_DONE',len(items),flush=True)


if __name__=='__main__': main()
