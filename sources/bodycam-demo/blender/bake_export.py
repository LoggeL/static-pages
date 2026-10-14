"""Bounded attribute quantization, lossless meshopt codec and shared decal images."""
import json
import hashlib
from pathlib import Path
import struct
import subprocess
import shutil


IMAGE_COMPARE_SCRIPT = r'''
import hashlib, json, sys
from pathlib import Path
from PIL import Image
report = []
for item in json.loads(Path(sys.argv[1]).read_text()):
    with Image.open(item['exportedFile']) as image:
        exported = image.convert('RGBA'); size = exported.size; pixels = exported.tobytes()
    with Image.open(item['sourceFile']) as image:
        source = image.convert('RGBA')
        if source.size != size or source.tobytes() != pixels:
            raise ValueError('Decal pixels changed during Blender export: ' + item['name'])
    report.append({'name':item['name'],'width':size[0],'height':size[1],
        'rgbaSHA256':hashlib.sha256(pixels).hexdigest(),'pixelExact':True})
print(json.dumps(report))
'''


NODE_SCRIPT = r'''
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { reorder, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const [input, output, verification, settingsFile] = process.argv.slice(2);
const settings=JSON.parse(await fs.readFile(settingsFile,'utf8'));
if (![10,12,16].includes(settings.normalQuantizationBits) || settings.uv1Bits !== 16 || settings.codec !== 'meshopt' || settings.vertexColorBits !== 8)
  throw new Error('Export supports 10/12/16-bit normals, 16-bit UV1, 8-bit vertex colors and meshopt');
if (settings.positionQuantizationBits !== 16 || !(settings.maxPositionErrorMeters>0) || !(settings.uv0GridMeters>0))
  throw new Error('Position encoding requires 16 bits and positive precision bounds');
const doc = await io.read(input);
function fingerprint(document) {
  const hash = crypto.createHash('sha256');
  const items = document.getRoot().listNodes().slice().sort((a,b)=>a.getName().localeCompare(b.getName()));
  let accessors = 0;
  for (const node of items) {
    hash.update(JSON.stringify([node.getName(), node.getMatrix(), node.getExtras()]));
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      hash.update(JSON.stringify([primitive.getMode(), primitive.getMaterial()?.getName()]));
      for (const semantic of primitive.listSemantics().sort()) {
        const array = primitive.getAttribute(semantic).getArray();
        hash.update(semantic); hash.update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength)); accessors++;
      }
      const indices = primitive.getIndices()?.getArray();
      if (indices) {
        const canonical = new Uint32Array(indices.length);
        for (let i=0;i<indices.length;i+=3) {
          const t=[indices[i],indices[i+1],indices[i+2]];
          const k=t.indexOf(Math.min(...t));
          canonical.set([t[k],t[(k+1)%3],t[(k+2)%3]],i);
        }
        hash.update(new Uint8Array(canonical.buffer));
      }
    }
  }
  for(const texture of document.getRoot().listTextures().slice().sort((a,b)=>a.getName().localeCompare(b.getName()))) {
    hash.update(JSON.stringify([texture.getName(),texture.getMimeType()]));
    const bytes=texture.getImage(); if(bytes) hash.update(bytes);
  }
  return { hash:hash.digest('hex'), nodes:items.length, accessors };
}
if (output === '--verify') {
  const expected=JSON.parse(await fs.readFile(verification,'utf8')).after,actual=fingerprint(doc);
  if (actual.hash !== expected.hash) throw new Error('Externalized geometry or image bytes changed');
  for(const ext of doc.getRoot().listExtensionsUsed()) if(ext.extensionName==='EXT_meshopt_compression') ext.dispose();
  await doc.transform(unpartition());
  await io.write(process.argv[6],doc);
  console.log(JSON.stringify({externalizedReadback:true,...actual}));
  process.exit(0);
}
const precision = {positionBits:16,positionMaxErrorMeters:0,positionFallbackMeshes:0,preventedCollapsedOrFlippedTriangles:0,
  normalBits:settings.normalQuantizationBits,normalMaxComponentError:0,normalMaxAngleDegrees:0,
  uv1MaxError:0,uv1FallbackMeshes:0,preventedCollapsedOrFlippedUVTriangles:0,
  uv1CoveragePreservedMeshes:[],
  uv0GridMeters:settings.uv0GridMeters,uv0MaxError:0,vertexColorBits:8,vertexColorMaxError:0};
const preserveUV1=new Set(settings.uv1Float32Meshes ?? []);
const preservedUV1Sources=new Set();
const seen = new Set();
for (const node of doc.getRoot().listNodes()) {
  if (node.getName().startsWith('DOOR_')) continue;
  const matrix=node.getMatrix();
  if (matrix.some((v,i)=>v !== ([0,5,10,15].includes(i) ? 1 : 0)))
    throw new Error('Static meshes must be flattened before bounded position encoding');
  const nodePositions=node.getMesh()?.listPrimitives().map(p=>p.getAttribute('POSITION')).filter(Boolean) ?? [];
  if (nodePositions.length !== 1) throw new Error('Expected one room/material primitive per static node');
  const positionSource=nodePositions[0].getArray();
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<positionSource.length;i++) {low[i%3]=Math.min(low[i%3],positionSource[i]);high[i%3]=Math.max(high[i%3],positionSource[i]);}
  const center=low.map((v,i)=>(v+high[i])/2);
  const positionScale=Math.max(...low.map((v,i)=>(high[i]-v)/2));
  if (!(positionScale>0)) throw new Error('Degenerate static bounding box');
  const packedPositions=Int16Array.from(positionSource,(x,i)=>Math.round((x-center[i%3])/positionScale*32767));
  const indices=node.getMesh().listPrimitives()[0].getIndices().getArray();
  const cross=(values,a,b,c)=>{
    const u=[0,1,2].map(k=>values[b*3+k]-values[a*3+k]);
    const v=[0,1,2].map(k=>values[c*3+k]-values[a*3+k]);
    return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  };
  let invalidTriangles=0;
  for(let i=0;i<indices.length;i+=3) {
    const a=cross(positionSource,indices[i],indices[i+1],indices[i+2]);
    const b=cross(packedPositions,indices[i],indices[i+1],indices[i+2]);
    if (a[0]*b[0]+a[1]*b[1]+a[2]*b[2]<=0) invalidTriangles++;
  }
  const packPosition=invalidTriangles===0;
  if (packPosition) node.setTranslation(center).setScale([positionScale,positionScale,positionScale]);
  else { precision.positionFallbackMeshes++; precision.preventedCollapsedOrFlippedTriangles+=invalidTriangles; }
  for (const prim of node.getMesh()?.listPrimitives() ?? []) for (const semantic of ['POSITION','NORMAL','TEXCOORD_0','TEXCOORD_1','COLOR_0']) {
    const attr = prim.getAttribute(semantic);
    if (!attr || seen.has(attr)) continue; seen.add(attr);
    const source = attr.getArray();
    if (semantic === 'POSITION') {
      if (!packPosition) continue; // Preserve thin rims and paper folds exactly.
      const output=packedPositions;
      for(let i=0;i<source.length;i++) precision.positionMaxErrorMeters=Math.max(precision.positionMaxErrorMeters,
        Math.abs(source[i]-(output[i]/32767*positionScale+center[i%3])));
      attr.setArray(output).setNormalized(true);
    } else if (semantic === 'TEXCOORD_0') {
      const output=Float32Array.from(source,x=>Math.round(x/precision.uv0GridMeters)*precision.uv0GridMeters);
      for(let i=0;i<source.length;i++) precision.uv0MaxError=Math.max(precision.uv0MaxError,Math.abs(source[i]-output[i]));
      attr.setArray(output);
    } else if (semantic === 'NORMAL') {
      const max = 2**(settings.normalQuantizationBits-1)-1, scale=2**(16-settings.normalQuantizationBits);
      const output = Int16Array.from(source,x=>Math.round(Math.max(-1,Math.min(1,x))*max)*scale);
      for(let i=0;i<source.length;i++) precision.normalMaxComponentError=Math.max(precision.normalMaxComponentError,Math.abs(source[i]-output[i]/32767));
      for(let i=0;i<source.length;i+=3) {
        const a=source.subarray(i,i+3),b=output.subarray(i,i+3);
        const dot=(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(Math.hypot(...a)*Math.hypot(...b));
        precision.normalMaxAngleDegrees=Math.max(precision.normalMaxAngleDegrees,Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI);
      }
      attr.setArray(output).setNormalized(true);
    } else if (semantic === 'COLOR_0') {
      const maximum=attr.getNormalized() ? (source instanceof Uint16Array ? 65535 : 255) : 1;
      const output=Uint8Array.from(source,x=>Math.round(Math.max(0,Math.min(1,x/maximum))*255));
      for(let i=0;i<source.length;i++) precision.vertexColorMaxError=Math.max(precision.vertexColorMaxError,Math.abs(source[i]/maximum-output[i]/255));
      attr.setArray(output).setNormalized(true);
    } else {
      // These thin source charts lose their sole interior texel after UV16 rounding.
      const preserveSource=[...preserveUV1].find(name=>node.getName()===name || node.getName().startsWith(name+'__'));
      if(preserveSource) {
        precision.uv1FallbackMeshes++;
        precision.uv1CoveragePreservedMeshes.push(node.getName());
        preservedUV1Sources.add(preserveSource);
        continue;
      }
      const output=Uint16Array.from(source,x=>Math.round(Math.max(0,Math.min(1,x))*65535));
      const area=(array,a,b,c)=>(array[b*2]-array[a*2])*(array[c*2+1]-array[a*2+1])
        -(array[b*2+1]-array[a*2+1])*(array[c*2]-array[a*2]);
      let invalid=0;
      for(let i=0;i<indices.length;i+=3) {
        if(area(source,indices[i],indices[i+1],indices[i+2])*area(output,indices[i],indices[i+1],indices[i+2])<=0) invalid++;
      }
      if(invalid) {precision.uv1FallbackMeshes++;precision.preventedCollapsedOrFlippedUVTriangles+=invalid;continue;}
      for(let i=0;i<source.length;i++) precision.uv1MaxError=Math.max(precision.uv1MaxError,Math.abs(source[i]-output[i]/65535));
      attr.setArray(output).setNormalized(true);
    }
  }
}
if(preservedUV1Sources.size!==preserveUV1.size)
  throw new Error('A configured Float32 UV1 mesh was not found; check the current layout');
if (precision.positionMaxErrorMeters>settings.maxPositionErrorMeters)
  throw new Error(`Position error exceeds configured limit: ${precision.positionMaxErrorMeters}`);
doc.createExtension(KHRMeshQuantization).setRequired(true);
await doc.transform(reorder({encoder:MeshoptEncoder}));
const before = fingerprint(doc);
// Precision reduction above is bounded and measured. The following codec preserves those bytes.
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
});
await io.write(output,doc);
const after = fingerprint(await io.read(output));
if (before.hash !== after.hash) throw new Error('Meshopt changed source attributes, indices, pivots or metadata');
await fs.writeFile(verification,JSON.stringify({version:'gltf-transform 4.5.1 / meshoptimizer 1.3.0',before,after,codecLossless:true,precision},null,2));
'''


def read_glb(path):
    data = Path(path).read_bytes()
    magic, version, total = struct.unpack_from('<III', data)
    if magic != 0x46546c67 or version != 2 or total != len(data): raise ValueError('Invalid GLB header')
    size = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20+size])
    binary_offset = 20+size+8
    return document, data[binary_offset:]


def write_glb(path, document, binary):
    packed = json.dumps(document, separators=(',', ':'), ensure_ascii=False).encode()
    packed += b' ' * (-len(packed) % 4)
    binary += b'\0' * (-len(binary) % 4)
    data = struct.pack('<III',0x46546c67,2,12+8+len(packed)+8+len(binary))
    data += struct.pack('<II',len(packed),0x4e4f534a)+packed
    data += struct.pack('<II',len(binary),0x004e4942)+binary
    Path(path).write_bytes(data)


def restore_decal_encoding(path, public, work):
    """Reuse optimized source bytes after verifying Blender's decoded RGBA exactly.

    The texture index declares the actual source filename and encoding.
    Blender may export WebP sources as genuine PNGs. Normalize their encoding and
    glTF metadata before the strict meshopt/external-buffer byte fingerprint.
    """
    document, binary = read_glb(path)
    index = json.loads((public / 'textures/index.json').read_text())['decals']
    replacements, checks, webp_images = {}, [], set()
    for image_index, image in enumerate(document.get('images', [])):
        key = Path(image.get('name', '')).stem
        if key not in index or 'bufferView' not in image: continue
        source_path = public / 'textures' / index[key]['file']
        source = source_path.read_bytes()
        mime = ('image/webp' if source[:4] == b'RIFF' and source[8:12] == b'WEBP' else
                'image/png' if source.startswith(b'\x89PNG\r\n\x1a\n') else
                'image/jpeg' if source.startswith(b'\xff\xd8\xff') else None)
        if mime is None: raise ValueError(f'Unsupported source decal encoding: {source_path}')
        suffix_mime = {'.webp': 'image/webp', '.png': 'image/png',
                       '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}.get(source_path.suffix.lower())
        if suffix_mime != mime:
            raise ValueError(f'Source decal extension differs from encoding: {source_path}')
        view_index = image['bufferView']; view = document['bufferViews'][view_index]
        if view.get('buffer', 0) != 0: raise ValueError('Expected embedded Blender image before normalization')
        offset = view.get('byteOffset', 0)
        exported = binary[offset:offset + view['byteLength']]
        if exported != source:
            check_path = work / 'raw' / ('decal-source-check-' + key + '.image')
            check_path.write_bytes(exported)
            checks.append({'name':key, 'exportedFile':str(check_path), 'sourceFile':str(source_path)})
            replacements[view_index] = source
        image['mimeType'] = mime
        if mime == 'image/webp': webp_images.add(image_index)
    comparison = []
    if checks:
        manifest = work / 'raw/decal-source-check.json'; manifest.write_text(json.dumps(checks))
        result = subprocess.run(['python3', '-c', IMAGE_COMPARE_SCRIPT, str(manifest)],
                                check=True, text=True, capture_output=True)
        comparison = json.loads(result.stdout)
    if webp_images:
        for texture in document.get('textures', []):
            source = texture.get('source')
            if source in webp_images:
                texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source':source}
                texture.pop('source', None)
        for key in ['extensionsUsed', 'extensionsRequired']:
            document[key] = sorted(set(document.get(key, [])) | {'EXT_texture_webp'})
    # Rebuild the single raw Blender buffer, keeping all accessor offsets within
    # their bufferViews intact. No geometry attributes or image pixels change.
    output = bytearray()
    for view_index, view in enumerate(document.get('bufferViews', [])):
        if view.get('buffer', 0) != 0: raise ValueError('Expected one raw Blender buffer')
        offset = view.get('byteOffset', 0)
        data = replacements.get(view_index, binary[offset:offset + view['byteLength']])
        output.extend(b'\0' * (-len(output) % 4))
        view['byteOffset'] = len(output); view['byteLength'] = len(data)
        output.extend(data)
    document['buffers'][0]['byteLength'] = len(output)
    write_glb(path, document, bytes(output))
    report = {'restoredDecalEncodings':len(replacements), 'rgbaReadback':comparison,
              'webpImages':len(webp_images), 'geometryUnchanged':True}
    (work / 'reports/decal-source-encoding.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def externalize_images(path, public):
    document, source = read_glb(path)
    index = json.loads((public/'textures/index.json').read_text())['decals']
    externalized, removed = [], set()
    # glTF buffers may reference arbitrary binary files. Reuse exact image byte
    # ranges already present in prop GLBs, instead of embedding them a second
    # time. Standard GLTFLoader supports these buffers without custom plugins.
    shared_images = {}
    for prop in sorted((public/'models/props').glob('*.glb'),key=lambda p:p.stat().st_size,reverse=True):
        prop_doc, prop_bin = read_glb(prop)
        header_bytes = len(prop.read_bytes())-len(prop_bin)
        for image in prop_doc.get('images',[]):
            if 'bufferView' not in image: continue
            view = prop_doc['bufferViews'][image['bufferView']]
            if view.get('buffer',0) != 0: continue
            offset,count=view.get('byteOffset',0),view['byteLength']
            digest=hashlib.sha256(prop_bin[offset:offset+count]).hexdigest()
            shared_images[digest]=(prop,header_bytes+offset,count)
    shared, dependencies = [], {}
    for image in document.get('images', []):
        name = image.get('name', '')
        key = Path(name).stem
        if 'bufferView' not in image: continue
        view_index=image['bufferView']; view=document['bufferViews'][view_index]
        if key in index:
            image.pop('bufferView'); removed.add(view_index)
            image['uri'] = '../textures/' + index[key]['file']
            externalized.append(image['uri'])
        else:
            offset,count=view.get('byteOffset',0),view['byteLength']
            match=shared_images.get(hashlib.sha256(source[offset:offset+count]).hexdigest())
            if match:
                image.pop('bufferView'); removed.add(view_index)
                shared.append((image,*match))
    binary = bytearray(); views = []; remap = {}
    def copy_slice(start, count):
        binary.extend(b'\0' * (-len(binary) % 4)); offset = len(binary)
        binary.extend(source[start:start+count]); return offset
    for old_index, view in enumerate(document.get('bufferViews', [])):
        if old_index in removed: continue
        remap[old_index] = len(views)
        if view.get('buffer', 0) == 0:
            view['byteOffset'] = copy_slice(view.get('byteOffset', 0),view['byteLength'])
        extension = view.get('extensions', {}).get('EXT_meshopt_compression')
        if extension:
            if extension['buffer'] != 0: raise ValueError('Unexpected compressed buffer index')
            extension['byteOffset'] = copy_slice(extension.get('byteOffset',0),extension['byteLength'])
        views.append(view)
    document['bufferViews'] = views
    for accessor in document.get('accessors', []):
        if 'bufferView' in accessor: accessor['bufferView'] = remap[accessor['bufferView']]
        if 'sparse' in accessor:
            for kind in ['indices','values']:
                record=accessor['sparse'][kind]; record['bufferView']=remap[record['bufferView']]
    for image in document.get('images', []):
        if 'bufferView' in image: image['bufferView'] = remap[image['bufferView']]
    document['buffers'][0]['byteLength'] = len(binary)
    for image,prop,offset,count in shared:
        if prop.name not in dependencies:
            dependencies[prop.name]={'uri':'props/'+prop.name,'bytes':prop.stat().st_size,
                'sha256':hashlib.sha256(prop.read_bytes()).hexdigest(),'buffer':len(document['buffers'])}
            document['buffers'].append({'uri':'props/'+prop.name,'byteLength':prop.stat().st_size})
        image['bufferView']=len(document['bufferViews'])
        document['bufferViews'].append({'buffer':dependencies[prop.name]['buffer'],'byteOffset':offset,'byteLength':count})
    write_glb(path,document,bytes(binary))
    return externalized,list(dependencies.values()),sum(item[3] for item in shared)


def compress_house(input_path, output_path, work, public, settings):
    source_images = restore_decal_encoding(input_path, public, work)
    tools = work / 'tools'; tools.mkdir(parents=True, exist_ok=True)
    versions = {'@gltf-transform/core':'4.5.1','@gltf-transform/extensions':'4.5.1',
        '@gltf-transform/functions':'4.5.1','meshoptimizer':'1.3.0'}
    dependencies = [f'{name}@{version}' for name,version in versions.items()]
    def installed_version(name):
        manifest = tools/'node_modules'/name/'package.json'
        return json.loads(manifest.read_text()).get('version') if manifest.exists() else None
    if any(installed_version(name) != version for name,version in versions.items()):
        subprocess.run(['npm','install','--prefix',str(tools),'--no-save','--no-package-lock',*dependencies],check=True)
    script = tools/'compress-house.mjs'; script.write_text(NODE_SCRIPT)
    verification = work/'reports/meshopt.json'
    settings_path = work/'raw/compression-settings.json'
    settings_path.write_text(json.dumps(settings))
    subprocess.run(['node',str(script),str(input_path),str(output_path),str(verification),str(settings_path)],check=True)
    externalized, shared, saved = externalize_images(output_path, public)
    check_root=work/'export-check'
    (check_root/'models').mkdir(parents=True,exist_ok=True)
    for link,target in [(check_root/'models/props',public/'models/props'),(check_root/'textures',public/'textures')]:
        if not link.exists(): link.symlink_to(target,target_is_directory=True)
        if link.resolve() != target.resolve(): raise ValueError(f'Unexpected export-check dependency: {link}')
    check_model=check_root/'models/house.glb'; shutil.copy2(output_path,check_model)
    subprocess.run(['node',str(script),str(check_model),'--verify',str(verification),str(settings_path),
        str(work/'raw/house-decoded.glb')],check=True)
    return {'codec':'EXT_meshopt_compression','quantized':True,'codecLosslessVerified':True,'precision':json.loads(verification.read_text())['precision'],
        'decoder':'three/addons/libs/meshopt_decoder.module.js (three@0.170.0)',
        'externalDecals':externalized,'sharedImageBuffers':shared,'sharedImageBytes':saved,
        'externalizedReadbackVerified':True,'sourceImageEncoding':source_images,'bytes':output_path.stat().st_size}
