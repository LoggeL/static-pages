import bpy, os, sys, traceback
HERE='/Users/logge/Documents/Projects/static-pages/sources/bodycam-demo/blender'
OUT=sys.argv[sys.argv.index('--')+1]
src=open(HERE+'/props_vehicle.py').read()
src=src.replace("exec(compile(open(os.path.join(HERE, 'props_vehicle_finish.py')).read(), 'props_vehicle_finish.py', 'exec'), globals())","")
src=src.replace("if __name__ == '__main__':\n    main()","")
src=src.replace("HERE = os.path.dirname(os.path.abspath(__file__))","HERE = %r"%HERE)
cars=open(HERE+'/props_vehicle_cars.py').read().replace("exec(compile(open(os.path.join(HERE, 'props_vehicle_finish.py')).read(), 'props_vehicle_finish.py', 'exec'), globals())","")
open(OUT+'/_cars.py','w').write(cars)
src=src.replace("open(os.path.join(HERE, 'props_vehicle_cars.py'))","open(%r)"%(OUT+'/_cars.py'))
g={'__name__':'vehicle','__file__':HERE+'/props_vehicle.py'}
bpy.ops.wm.read_factory_settings(use_empty=True)
exec(compile(src,'props_vehicle.py','exec'),g)
class D(dict):
    def __missing__(self,k):
        v=dict(col=(0.55,0.55,0.52),rough=0.5) if 'plate' in k else dict(col=(0.05,0.05,0.05),rough=0.4)
        self[k]=v; return v
g['UNIQUE_TEX']=D()
g['make_interior_police']=lambda S,C: None
import bmesh
def recess(bm, faces, depth, rim=0.004, rim_mat=None, floor_mat=None, mats=None):
    # even offset explodes on sliver faces at the lamp cut-outs (Blender 5.2)
    if not faces: return [], []
    res = bmesh.ops.inset_region(bm, faces=faces, thickness=rim, depth=0.0, use_even_offset=False, use_boundary=True)
    walls1 = res['faces']
    res2 = bmesh.ops.inset_region(bm, faces=faces, thickness=0.0005, depth=-depth, use_even_offset=False, use_boundary=True)
    walls2 = res2['faces']
    if floor_mat is not None:
        for f in faces: f.material_index = floor_mat
    if rim_mat is not None:
        for f in walls2: f.material_index = rim_mat
    return faces, walls1 + walls2
g['recess']=recess
_j=g['join']
def join_dbg(obs,name):
    for o in obs:
        if o is None: continue
        d=o.dimensions
        if max(d)>6: print('HUGE',o.name,[round(x,2) for x in d],'->',name)
    return _j([o for o in obs if o is not None],name)
g['join']=join_dbg
def wrap(n):
    f=g[n]
    def w(*a,**k):
        r=f(*a,**k)
        for o in (r if isinstance(r,(list,tuple)) else [r]):
            if hasattr(o,'dimensions'):
                bpy.context.view_layer.update()
                bb=[o.matrix_world@Vector(c) for c in o.bound_box]
                print('PART',n,o.name,[round(x,2) for x in o.dimensions],'z',round(min(b.z for b in bb),2),round(max(b.z for b in bb),2),'y',round(min(b.y for b in bb),2),round(max(b.y for b in bb),2))
        return r
    g[n]=w
from mathutils import Vector
for n in ['make_wipers','make_push_bumper','make_grille_mesh','make_mirror','make_spotlight','make_arch_lips','make_antennas','make_handle','make_plate']: wrap(n)
try:
    r=g['assemble_police']()
    print('ASSEMBLED', {k:(type(v).__name__, len(v) if isinstance(v,(list,tuple)) else '') for k,v in r.items()})
except Exception:
    traceback.print_exc()
obs=[o for o in bpy.data.objects if o.type=='MESH']
bpy.context.view_layer.update()
for o in obs:
    far={}
    for p in o.data.polygons:
        c=o.matrix_world@p.center
        if abs(c.x)>1.3 or abs(c.y)>3.2 or c.z>2.6 or c.z<-0.2:
            n=o.data.materials[p.material_index].name if o.data.materials else '-'; far[n]=far.get(n,0)+1
    print('OBJ',o.name,[round(x,2) for x in o.dimensions],len(o.data.polygons),'FAR',far)
print('OBJECTS',len(obs),'TRIS',sum(len(o.data.loop_triangles) or (o.data.calc_loop_triangles() or len(o.data.loop_triangles)) for o in obs))
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/police_raw.blend')
sc=bpy.context.scene
for o in obs:
    if o.name not in sc.collection.all_objects: pass
sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.light='STUDIO'; sc.display.shading.color_type='MATERIAL'
sc.render.resolution_x,sc.render.resolution_y=900,520
from mathutils import Vector
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam; cam.data.lens=40
for k,(p,t) in {'fq':((5.5,-6.5,2.2),(0,-0.2,0.8)),'rq':((-5.5,6.5,2.4),(0,0.2,0.9)),'side':((9.5,0,1.2),(0,0,0.9))}.items():
    p,t=Vector(p),Vector(t); cam.location=p; cam.rotation_euler=(t-p).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath=OUT+'/raw_'+k+'.png'; bpy.ops.render.render(write_still=True)
