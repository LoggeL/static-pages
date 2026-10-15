import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';

// house_shell.py ended the far ground grid at Blender y = -21.5 instead of -20.0, leaving a
// 1.5 m strip of void between the opposite sidewalk and the neighbour lawns. The generator is
// fixed; until the next bake this fills the strip (three.js z 19.95..21.6) visually and for collision.
export const SITE_GAPS = [{ x: [-44, 46], z: [19.95, 21.6], probe: [4.6, 20.75], material: 'M_grass_dead' }];

/** Adds filler geometry where the baked site has no ground. Returns the added visual meshes. */
export function patchSiteGaps(house, collisionSource = null, gaps = SITE_GAPS) {
  house.updateWorldMatrix(true, true);
  collisionSource?.updateWorldMatrix(true, true);
  const sources = [];
  house.traverse(node => { if (node.isMesh && node.geometry?.attributes.position) sources.push(node); });
  const ray = new Raycaster(), added = [];
  ray.layers.enableAll();
  for (const gap of gaps) {
    ray.set(new Vector3(gap.probe[0], 5, gap.probe[1]), new Vector3(0, -1, 0));
    ray.far = 6;
    if (ray.intersectObjects(sources, false).length) continue; // Already baked with ground.
    const lawn = sources.find(mesh => [mesh.material].flat().some(material => material?.name === gap.material));
    if (!lawn) continue;
    const geometry = stripGeometry(lawn, gap, house);
    const strip = new Mesh(geometry, lawn.material);
    strip.name = `SITE_gap_fill_${added.length}`;
    strip.receiveShadow = true;
    strip.userData.surface = 'grass';
    house.add(strip);
    strip.updateWorldMatrix(true, false);
    added.push(strip);
    if (collisionSource) {
      const solid = new Mesh(new BufferGeometry().setAttribute('position', geometry.attributes.position.clone())
        .setIndex(geometry.index.clone()), new MeshBasicMaterial());
      solid.name = `${strip.name}_collision`;
      solid.userData.surface = 'grass';
      solid.matrix.copy(collisionSource.matrixWorld).invert().multiply(house.matrixWorld);
      solid.matrix.decompose(solid.position, solid.quaternion, solid.scale);
      collisionSource.add(solid);
      solid.updateWorldMatrix(true, false);
    }
  }
  return added;
}

function stripGeometry(lawn, gap, parent) {
  // Lawn vertices just beyond the gap provide height, lightmap texel, vertex colour and UV mapping.
  const source = lawn.geometry.attributes, world = new Vector3(), samples = [];
  for (let i = 0; i < source.position.count; i++) {
    world.fromBufferAttribute(source.position, i).applyMatrix4(lawn.matrixWorld);
    // The lawn grid rows are 3 m apart; the window must span two rows for a planar UV fit.
    if (world.z > gap.z[1] - 0.15 && world.z < gap.z[1] + 3.6 && world.x > gap.x[0] - 1 && world.x < gap.x[1] + 1)
      samples.push({ index: i, x: world.x, y: world.y, z: world.z });
  }
  if (samples.length < 3) throw new Error('Site gap: no lawn samples');
  const fitUV = fitPlanar(samples, i => [source.uv.getX(i), source.uv.getY(i)]);
  const columns = Math.ceil(gap.x[1] - gap.x[0]) + 1, rows = [gap.z[0], 20.5, 21.05, gap.z[1]];
  const count = columns * rows.length;
  const position = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const uv1 = source.uv1 ? new Float32Array(count * 2) : null;
  const color = source.color ? new Float32Array(count * source.color.itemSize) : null;
  const inverse = parent.matrixWorld.clone().invert();
  let v = 0;
  for (let c = 0; c < columns; c++) {
    const x = Math.min(gap.x[1], gap.x[0] + c);
    let nearest = samples[0], best = Infinity;
    for (const sample of samples) {
      const d = (sample.x - x) ** 2 + 3 * (sample.z - gap.z[1]) ** 2;
      if (d < best) { best = d; nearest = sample; }
    }
    rows.forEach((z, r) => {
      const t = r / (rows.length - 1);
      // From the sidewalk edge down to the lawn, slightly under both so their edges stay on top.
      world.set(x, -0.112 + (nearest.y - 0.004 + 0.112) * t, z);
      world.applyMatrix4(inverse);
      world.toArray(position, v * 3);
      fitUV(x, z, uv, v * 2);
      if (uv1) { uv1[v * 2] = source.uv1.getX(nearest.index); uv1[v * 2 + 1] = source.uv1.getY(nearest.index); }
      if (color) for (let k = 0; k < source.color.itemSize; k++)
        color[v * source.color.itemSize + k] = source.color.getComponent(nearest.index, k);
      v++;
    });
  }
  const index = [];
  for (let c = 0; c < columns - 1; c++)
    for (let r = 0; r < rows.length - 1; r++) {
      const a = c * rows.length + r, b = a + rows.length;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  if (uv1) geometry.setAttribute('uv1', new BufferAttribute(uv1, 2));
  if (color) geometry.setAttribute('color', new BufferAttribute(color, source.color.itemSize));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Least-squares u,v = a·x + b·z + c over the samples; lawn UVs are planar world projections. */
function fitPlanar(samples, read) {
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rhs = [[0, 0, 0], [0, 0, 0]];
  for (const s of samples) {
    const row = [s.x, s.z, 1], value = read(s.index);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j];
      rhs[0][i] += row[i] * value[0]; rhs[1][i] += row[i] * value[1];
    }
  }
  const coefficients = rhs.map(b => solve3(m, b));
  return (x, z, out, offset) => {
    for (let k = 0; k < 2; k++) out[offset + k] = coefficients[k][0] * x + coefficients[k][1] * z + coefficients[k][2];
  };
}
function solve3(m, b) {
  const a = m.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    if (Math.abs(a[i][i]) < 1e-12) return [0, 0, 0];
    for (let r = 0; r < 3; r++) if (r !== i) {
      const f = a[r][i] / a[i][i];
      for (let k = i; k < 4; k++) a[r][k] -= f * a[i][k];
    }
  }
  return a.map((row, i) => row[3] / row[i]);
}
