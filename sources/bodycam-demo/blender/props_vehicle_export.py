import bpy, bmesh, sys, math
from mathutils import Vector
OUT=sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.open_mainfile(filepath=OUT+'/police_raw.blend')
sc=bpy.context.scene
for o in list(bpy.data.objects):
    if o.type!='MESH': bpy.data.objects.remove(o)
def sel(obs,active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active=active
body=bpy.data.objects['police_suv_body']
bm=bmesh.new(); bm.from_mesh(body.data)
bad=[v for v in bm.verts if abs(v.co.x)>1.25 or abs(v.co.y)>3.1 or v.co.z>2.4 or v.co.z<-0.05 or any(c!=c for c in v.co)]
print('BAD VERTS',len(bad)); bmesh.ops.delete(bm,geom=bad,context='VERTS'); bm.to_mesh(body.data); bm.free()
# lightbar modules: four phase groups
groups={}
for o in [o for o in bpy.data.objects if o.name.startswith('LB_')]:
    _,col,i=o.name.split('_'); key='LB_'+col+('' if col=='white' else '_'+'AB'[int(i)%2]); groups.setdefault(key,[]).append(o)
for key,obs in groups.items():
    sel(obs,obs[0]); bpy.ops.object.join(); obs[0].name=key; obs[0].data.name=key
    # own material per group so the runtime can switch them independently
    m=obs[0].data.materials[0].copy(); m.name='ME_'+key; obs[0].data.materials.clear(); obs[0].data.materials.append(m)
wheels=[o for o in bpy.data.objects if '_wheel_' in o.name]
for w in wheels:
    w.data=w.data.copy()
for o in bpy.data.objects:
    if o.type=='MESH':
        for p in o.data.polygons: p.use_smooth=True
root=bpy.data.objects.new('police_suv',None); sc.collection.objects.link(root)
for o in bpy.data.objects:
    if o.type=='MESH' and o.parent is None: o.parent=root
for m in bpy.data.materials:
    if m.name=='MU_police_body':
        b=m.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value=(0.012,0.013,0.015,1); b.inputs['Roughness'].default_value=0.28
        for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
        if 'Coat Weight' in b.inputs: b.inputs['Coat Weight'].default_value=0.6; b.inputs['Coat Roughness'].default_value=0.06
    if m.name=='M_glass':
        b=m.node_tree.nodes.get('Principled BSDF'); b.inputs['Alpha'].default_value=0.82; b.inputs['Base Color'].default_value=(0.01,0.012,0.013,1)
        if 'Transmission Weight' in b.inputs: b.inputs['Transmission Weight'].default_value=0
        m.surface_render_method='BLENDED' if hasattr(m,'surface_render_method') else None
bpy.ops.object.select_all(action='SELECT')
print('DIMS',[ (o.name,[round(x,2) for x in o.dimensions]) for o in bpy.data.objects if o.type=='MESH' and 'LB' not in o.name])
print('MATS',sorted({m.name for o in bpy.data.objects if o.type=='MESH' for m in o.data.materials}))
bpy.ops.export_scene.gltf(filepath=OUT+'/police_suv.glb',export_format='GLB',export_apply=True,export_yup=True,export_extras=True,export_materials='EXPORT')
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/police_suv.blend')
# preview (Eevee, simple light)
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[1].default_value=0.6
sun=bpy.data.objects.new('sun',bpy.data.lights.new('sun','SUN')); sun.data.energy=3; sun.rotation_euler=(0.9,0.2,0.6); sc.collection.objects.link(sun)
pl=bpy.data.meshes.new('g'); bmg=bmesh.new(); bmesh.ops.create_grid(bmg,x_segments=1,y_segments=1,size=30); bmg.to_mesh(pl); g=bpy.data.objects.new('g',pl); sc.collection.objects.link(g)
sc.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x,sc.render.resolution_y=900,520
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam; cam.data.lens=40
for k,(p,t) in {'fq':((4.5,-6.0,1.9),(0,-0.2,0.8)),'rq':((-5,6.0,2.2),(0,0.2,0.9))}.items():
    p,t=Vector(p),Vector(t); cam.location=p; cam.rotation_euler=(t-p).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=OUT+'/fin_'+k+'.png'; bpy.ops.render.render(write_still=True)
