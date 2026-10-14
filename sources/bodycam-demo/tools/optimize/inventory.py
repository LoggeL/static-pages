#!/usr/bin/env python3
"""Read-only inventory of deployed bodycam assets (Pillow required).

Triangle counts use accessor metadata, including Meshopt/Draco assets, without
decoding geometry. "unique" counts each mesh definition once; "instantiated"
counts occurrences in the default scene, including EXT_mesh_gpu_instancing.
Degenerate triangles are not removed and draw/shadow passes are not counted.
"""

import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import struct
from urllib.parse import unquote, urlparse

from PIL import Image


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".ktx", ".ktx2", ".avif", ".gif", ".bmp", ".tif", ".tiff"}
KTX2_MAGIC = b"\xabKTX 20\xbb\r\n\x1a\n"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def image_info(data):
    """Use magic bytes, so legacy .jpg URLs containing WebP stay measurable."""
    if data.startswith(KTX2_MAGIC):
        if len(data) < 80:
            raise ValueError("Truncated KTX2 header")
        fields = struct.unpack_from("<9I", data, 12)
        return {"format": "KTX2", "width": fields[2], "height": fields[3],
                "depth": fields[4], "layers": fields[5], "faces": fields[6],
                "mip_levels": fields[7], "supercompression_scheme": fields[8]}
    with Image.open(io.BytesIO(data)) as image:
        return {"format": image.format, "width": image.width, "height": image.height,
                "mode": image.mode, "frames": getattr(image, "n_frames", 1)}


def read_glb(data):
    if len(data) < 12:
        raise ValueError("Truncated GLB header")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Invalid GLB 2 header or byte length")
    offset, document, binary, json_bytes = 12, None, b"", 0
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Truncated GLB chunk header")
        size, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + size > len(data):
            raise ValueError("Truncated GLB chunk")
        chunk = data[offset:offset + size]
        if kind == 0x4E4F534A:
            document, json_bytes = json.loads(chunk), size
        elif kind == 0x004E4942:
            binary = chunk
        offset += size
    if document is None:
        raise ValueError("Missing GLB JSON chunk")
    return document, binary, json_bytes


def read_uri(uri, directory):
    if uri.startswith("data:"):
        header, payload = uri.split(",", 1)
        if ";base64" in header:
            return base64.b64decode(payload), "data-uri"
        from urllib.parse import unquote_to_bytes
        return unquote_to_bytes(payload), "data-uri"
    parsed = urlparse(uri)
    if parsed.scheme or parsed.netloc:
        raise ValueError(f"Remote URI not fetched: {uri}")
    path = directory / unquote(parsed.path)
    return path.read_bytes(), str(path.resolve())


def primitive_triangles(primitive, accessors):
    accessor_index = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
    if accessor_index is None:
        raise ValueError("Primitive has neither indices nor POSITION accessor")
    count = accessors[accessor_index]["count"]
    mode = primitive.get("mode", 4)
    if mode == 4:
        return count // 3
    if mode in (5, 6):
        return max(0, count - 2)
    return 0


def inspect_glb(path, data):
    doc, binary, json_bytes = read_glb(data)
    accessors, nodes = doc.get("accessors", []), doc.get("nodes", [])
    meshes = doc.get("meshes", [])
    mesh_triangles = [sum(primitive_triangles(p, accessors) for p in mesh.get("primitives", [])) for mesh in meshes]
    warnings, buffers, external_buffers = [], {}, []
    for index, buffer in enumerate(doc.get("buffers", [])):
        if "uri" not in buffer:
            buffers[index] = binary
            continue
        try:
            payload, origin = read_uri(buffer["uri"], path.parent)
            buffers[index] = payload
            external_buffers.append({"index": index, "uri": buffer["uri"], "origin": origin,
                                     "declared_bytes": buffer["byteLength"], "file_bytes": len(payload),
                                     "sha256": sha256(payload)})
        except (OSError, ValueError) as error:
            warnings.append(str(error))

    images = []
    for index, definition in enumerate(doc.get("images", [])):
        item = {"index": index, "name": definition.get("name"), "mime_type": definition.get("mimeType")}
        try:
            if "bufferView" in definition:
                view = doc["bufferViews"][definition["bufferView"]]
                source = buffers[view["buffer"]]
                start, length = view.get("byteOffset", 0), view["byteLength"]
                payload = source[start:start + length]
                if len(payload) != length:
                    raise ValueError(f"Image {index}: bufferView exceeds buffer")
                item.update({"storage": "external-buffer" if "uri" in doc["buffers"][view["buffer"]] else "embedded",
                             "buffer_index": view["buffer"], "buffer_view": definition["bufferView"],
                             "byte_offset": start})
            else:
                payload, origin = read_uri(definition["uri"], path.parent)
                item.update({"storage": "embedded" if origin == "data-uri" else "external-image", "uri": definition["uri"]})
            item.update({"bytes": len(payload), "sha256": sha256(payload), **image_info(payload)})
        except (OSError, ValueError, KeyError, IndexError) as error:
            item["error"] = str(error)
            warnings.append(f"Image {index}: {error}")
        images.append(item)

    def count_node(index, ancestry):
        if index in ancestry:
            raise ValueError("Cycle in scene nodes")
        node = nodes[index]
        triangles = mesh_triangles[node["mesh"]] if "mesh" in node else 0
        attributes = node.get("extensions", {}).get("EXT_mesh_gpu_instancing", {}).get("attributes", {})
        if attributes:
            counts = {accessors[a]["count"] for a in attributes.values()}
            if len(counts) != 1:
                raise ValueError("Inconsistent GPU instancing accessor counts")
            triangles *= counts.pop()
        return triangles + sum(count_node(child, ancestry | {index}) for child in node.get("children", []))

    scenes = [{"index": i, "name": scene.get("name"),
               "triangles_instantiated": sum(count_node(node, set()) for node in scene.get("nodes", []))}
              for i, scene in enumerate(doc.get("scenes", []))]
    default_scene = doc.get("scene", 0) if scenes else None
    embedded = [im for im in images if im.get("storage") == "embedded" and "bytes" in im]
    all_extensions = set()

    def collect_extensions(value):
        if isinstance(value, dict):
            all_extensions.update(value.get("extensions", {}).keys())
            for child in value.values():
                collect_extensions(child)
        elif isinstance(value, list):
            for child in value:
                collect_extensions(child)

    collect_extensions(doc)
    return {"json_chunk_bytes": json_bytes, "binary_chunk_bytes": len(binary),
            "triangles_unique": sum(mesh_triangles),
            "triangles_instantiated": scenes[default_scene]["triangles_instantiated"] if default_scene is not None else None,
            "default_scene": default_scene, "scenes": scenes, "mesh_count": len(meshes),
            "primitive_count": sum(len(m.get("primitives", [])) for m in meshes),
            "node_count": len(nodes), "node_names": [n.get("name", "") for n in nodes],
            "skin_count": len(doc.get("skins", [])), "material_count": len(doc.get("materials", [])),
            "animation_count": len(doc.get("animations", [])),
            "animation_names": [a.get("name", "") for a in doc.get("animations", [])],
            "extensions_used": doc.get("extensionsUsed", []), "extensions_required": doc.get("extensionsRequired", []),
            "extensions_present": sorted(all_extensions), "images": images,
            "embedded_image_bytes": sum(im["bytes"] for im in embedded),
            "embedded_image_unique_content_bytes": sum({im["sha256"]: im["bytes"] for im in embedded}.values()),
            "external_buffers": external_buffers, "warnings": warnings}


def inventory(root):
    files, glbs, textures, errors = [], [], [], []
    totals = Counter()
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if relative.parts[0] in ("audio", "_dev"):
            continue
        data = path.read_bytes()
        item = {"path": relative.as_posix(), "bytes": len(data), "sha256": sha256(data)}
        files.append(item)
        totals[relative.parts[0] if len(relative.parts) > 1 else "(root)"] += len(data)
        try:
            if path.suffix.lower() == ".glb":
                glb = {**item, **inspect_glb(path, data)}
                glbs.append(glb)
                errors.extend(f"{relative}: {message}" for message in glb["warnings"])
            elif path.suffix.lower() in IMAGE_SUFFIXES:
                textures.append({**item, "category": "lightmap" if "lightmaps" in relative.parts else "texture", **image_info(data)})
        except (OSError, ValueError, KeyError, IndexError, struct.error) as error:
            errors.append(f"{relative}: {error}")
    return {"schema_version": 1, "generated_utc": datetime.now(timezone.utc).isoformat(),
            "root": str(root), "excluded_roots": ["audio/", "_dev/"],
            "definitions": {"MB": "1000000 bytes", "MiB": "1048576 bytes",
                            "triangles_unique": "Every mesh primitive definition once, including unused meshes; not geometric deduplication.",
                            "triangles_instantiated": "Default scene traversal with node and EXT_mesh_gpu_instancing instances, no draw/shadow pass duplication.",
                            "compression_limits": "Accessor metadata remains readable with Meshopt/Draco. Geometry is not decoded; degenerate faces, quantization errors, actual decoded bounds and visual quality are not evaluated.",
                            "images": "Pixel dimensions from image headers; embedded image sizes are encoded bytes. External buffer images resolve byte offsets in their complete target files. Remote URIs are reported, never fetched."},
            "summary": {"total_bytes_without_audio": sum(f["bytes"] for f in files), "file_count": len(files),
                        "glb_count": len(glbs), "image_count": len(textures),
                        "bytes_by_top_level": dict(sorted(totals.items())),
                        "total_glb_bytes": sum(g["bytes"] for g in glbs),
                        "total_external_image_bytes": sum(i["bytes"] for i in textures),
                        "total_embedded_image_bytes": sum(g["embedded_image_bytes"] for g in glbs),
                        "triangles_unique_across_files": sum(g["triangles_unique"] for g in glbs)},
            "glbs": glbs, "textures": textures, "files": files, "errors": errors}


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown(report):
    summary = report["summary"]
    lines = ["# Bodycam asset inventory", "", f"Root: `{report['root']}`", "",
             f"Generated UTC: {report['generated_utc']}", "",
             f"Total without `audio/` and `_dev/`: **{summary['total_bytes_without_audio']:,} bytes** "
             f"({summary['total_bytes_without_audio'] / 1_000_000:.3f} MB, "
             f"{summary['total_bytes_without_audio'] / 1_048_576:.3f} MiB), {summary['file_count']} files.", "",
             "## Deployment size", "", "| Directory | Bytes | MB |", "| --- | ---: | ---: |"]
    for group, size in summary["bytes_by_top_level"].items():
        lines.append(f"| {cell(group)} | {size:,} | {size / 1_000_000:.3f} |")
    lines += ["", "## GLBs", "", "| Path | Bytes | Embedded image bytes | Triangles unique | Triangles instantiated | Nodes | Animations | Extensions |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |"]
    for g in report["glbs"]:
        lines.append(f"| `{cell(g['path'])}` | {g['bytes']:,} | {g['embedded_image_bytes']:,} | {g['triangles_unique']:,} | {g['triangles_instantiated']} | {g['node_count']} | {g['animation_count']} | {cell(', '.join(g['extensions_used']))} |")
    lines += ["", "## GLB image payloads", "", "| GLB / image | Storage | Bytes | Resolution | Format |", "| --- | --- | ---: | --- | --- |"]
    for g in report["glbs"]:
        for im in g["images"]:
            lines.append(f"| `{cell(g['path'])}` / {im['index']} {cell(im.get('name') or '')} | {im.get('storage', '?')} | {im.get('bytes', '?')} | {im.get('width', '?')} × {im.get('height', '?')} | {im.get('format', '?')} |")
    lines += ["", "## External textures and lightmaps", "", "| Path | Category | Bytes | Resolution | Format |", "| --- | --- | ---: | --- | --- |"]
    for im in report["textures"]:
        lines.append(f"| `{cell(im['path'])}` | {im['category']} | {im['bytes']:,} | {im['width']} × {im['height']} | {im['format']} |")
    lines += ["", "## Definitions and limitations", ""]
    lines += [f"- {cell(key)}: {value}" for key, value in report["definitions"].items()]
    lines += ["- SHA-256 for every deployed file and GLB image payload, external buffer dependencies, node names and animation names are in the JSON report.",
              "- Embedded payload totals count image declarations; identical image contents are also reported separately per GLB. External references are not added twice to deployment bytes."]
    if report["errors"]:
        lines += ["", "## Inspection errors", ""] + [f"- {cell(error)}" for error in report["errors"]]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4] / "public/bodycam-demo")
    parser.add_argument("--json", type=Path, required=True, help="JSON report destination (outside deploy root)")
    parser.add_argument("--markdown", type=Path, required=True, help="Markdown table destination (outside deploy root)")
    args = parser.parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        parser.error(f"Inventory root is not a directory: {root}")
    for output in (args.json, args.markdown):
        if output.resolve().is_relative_to(root):
            parser.error("Reports must be outside the deploy root to avoid counting their own output")
    report = inventory(root)
    for output, content in ((args.json, json.dumps(report, indent=2, ensure_ascii=False) + "\n"),
                            (args.markdown, markdown(report))):
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content, encoding="utf-8")
    print(json.dumps({**report["summary"], "inspection_error_count": len(report["errors"])}, indent=2))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
