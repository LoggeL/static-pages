#!/usr/bin/env python3
"""Read-only MIME and local-reference audit of the deployed Bodycam tree.

Run from any directory: python3 sources/bodycam-demo/tools/check_mime.py
Use --root PATH for an isolated fixture/deploy tree. No third-party modules.

JS is tokenized, not searched as prose: comments, diagnostics, regular expressions,
download names and Node screenshot/report outputs are not resource references.
Local imports, literal asset paths and simple string concatenations are checked.
The demo's material/decal/prop templates are expanded from their manifests. This is
not a JS interpreter: arbitrary user-supplied base URLs, query-selected IDs and
computed fetch arguments require the browser acceptance checks as well.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import struct
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


IMAGE_TYPES = {
    "image/webp": {".webp"}, "image/jpeg": {".jpg", ".jpeg", ".jpe"},
    "image/png": {".png"}, "image/gif": {".gif"}, "image/bmp": {".bmp"},
    "image/tiff": {".tif", ".tiff"}, "image/x-icon": {".ico"},
    "image/avif": {".avif"}, "image/ktx2": {".ktx2"}, "image/svg+xml": {".svg"},
}
IMAGE_EXTENSIONS = set().union(*IMAGE_TYPES.values())
ASSET_DIRS = {"textures", "lightmaps", "models", "data", "js", "_dev", "audio"}
RESOURCE_EXTENSIONS = IMAGE_EXTENSIONS | {
    ".json", ".js", ".mjs", ".css", ".html", ".glb", ".gltf", ".bin", ".wasm",
    ".ogg", ".opus", ".mp3", ".wav", ".flac", ".m4a", ".mp4", ".webm",
}
AUDIO_EXTENSIONS = {".ogg", ".opus", ".mp3", ".wav", ".flac", ".m4a"}
PATH_RE = re.compile(r"^[^\s<>\"'`{}]+$")


def image_mime(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP": return "image/webp"
    if data.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"): return "image/gif"
    if data.startswith(b"BM"): return "image/bmp"
    if data[:4] in (b"II*\x00", b"MM\x00*"): return "image/tiff"
    if data.startswith(b"\x00\x00\x01\x00"): return "image/x-icon"
    if data.startswith(b"\xabKTX 20\xbb\r\n\x1a\n"): return "image/ktx2"
    if data[4:8] == b"ftyp" and any(data[i:i + 4] in (b"avif", b"avis") for i in range(8, min(len(data), 64), 4)):
        return "image/avif"
    if re.search(rb"<svg(?:\s|>)", data.lstrip(b"\xef\xbb\xbf \t\r\n")):
        return "image/svg+xml"
    return None


@dataclass
class Token:
    kind: str
    value: str
    start: int
    line: int


def js_tokens(source: str) -> list[Token]:
    """Small lexer sufficient for ES-module URLs, including nested templates."""
    tokens = []
    i = 0
    line = 1

    def quoted(pos, quote):
        cursor = pos + 1
        parts = []
        while cursor < len(source):
            char = source[cursor]
            if char == "\\":
                cursor += 1
                if cursor < len(source):
                    parts.append({"n": "\n", "r": "\r", "t": "\t"}.get(source[cursor], source[cursor]))
                    cursor += 1
            elif char == quote:
                return cursor + 1, "".join(parts)
            elif quote == "`" and source[cursor:cursor + 2] == "${":
                begin = cursor
                cursor += 2
                depth = 1
                while cursor < len(source) and depth:
                    if source[cursor] in "'\"`":
                        cursor, _ = quoted(cursor, source[cursor])
                    else:
                        depth += (source[cursor] == "{") - (source[cursor] == "}")
                        cursor += 1
                parts.append(source[begin:cursor])
            else:
                parts.append(char)
                cursor += 1
        return cursor, "".join(parts)

    while i < len(source):
        char = source[i]
        if char.isspace():
            line += char == "\n"
            i += 1
            continue
        if source[i:i + 2] == "//":
            end = source.find("\n", i)
            i = len(source) if end == -1 else end
            continue
        if source[i:i + 2] == "/*":
            end = source.find("*/", i + 2)
            end = len(source) if end == -1 else end + 2
            line += source[i:end].count("\n")
            i = end
            continue
        if char in "'\"`":
            end, value = quoted(i, char)
            tokens.append(Token("template" if char == "`" else "string", value, i, line))
            line += source[i:end].count("\n")
            i = end
            continue
        # A regex literal may itself contain quotes or path fragments. Division
        # follows an operand; regex follows an expression-opening token/keyword.
        if char == "/" and (not tokens or tokens[-1].value in (
                "(", "=", ":", ",", "[", "!", "return", "=>", "||", "&&")):
            end = i + 1
            bracket = False
            while end < len(source) and source[end] != "\n":
                if source[end] == "\\": end += 2; continue
                if source[end] == "[": bracket = True
                elif source[end] == "]": bracket = False
                elif source[end] == "/" and not bracket:
                    end += 1
                    while end < len(source) and source[end].isalpha(): end += 1
                    tokens.append(Token("regex", source[i:end], i, line))
                    i = end
                    break
                end += 1
            else:
                tokens.append(Token("punct", char, i, line)); i += 1
            continue
        match = re.match(r"[A-Za-z_$][\w$]*", source[i:])
        if match:
            value = match.group()
            tokens.append(Token("identifier", value, i, line))
            i += len(value)
            continue
        pair = source[i:i + 2]
        value = pair if pair in ("=>", "??", "?.", "||", "&&", "==", "!=") else char
        tokens.append(Token("punct", value, i, line))
        i += len(value)
    return tokens


class Audit:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.errors: set[str] = set()
        self.references: set[tuple[str, str]] = set()
        self.notes: set[str] = set()
        self.images = self.embedded = self.glbs = self.aliases = 0
        self.external = self.audio = 0
        self.manifest = {}
        self.json_documents = {}
        self.prop_ids = []
        self.decal_alias_adapter = False

    def label(self, path):
        try: return str(path.relative_to(self.root))
        except ValueError: return str(path)

    def error(self, source, message):
        self.errors.add(f"{source}: {message}")

    def resource_path(self, value):
        if not isinstance(value, str) or not PATH_RE.fullmatch(value): return False
        try: path = urlsplit(value).path
        except ValueError: path = value  # reference() will report the invalid URL.
        return Path(path).suffix.lower() in RESOURCE_EXTENSIONS

    def reference(self, source, value, base=None, force=False):
        if not isinstance(value, str):
            self.error(source, f"resource path must be a string: {value!r}"); return None
        try: parsed = urlsplit(value)
        except ValueError as error:
            self.error(source, f"invalid resource URL {value!r}: {error}"); return None
        if parsed.scheme or parsed.netloc:
            self.external += 1
            return None
        if not force and not self.resource_path(value): return None
        path = unquote(parsed.path)
        if not path: return None
        if path.startswith("/bodycam-demo/"):
            target = self.root / path[len("/bodycam-demo/"):]
        elif path.startswith("/"):
            # --root is the deployed demo, while browser absolute paths are
            # relative to public/. Only the known demo mount can be audited.
            self.error(source, f"local URL outside /bodycam-demo/: {value}"); return None
        else:
            target = (base or self.root) / path
        target = target.resolve()
        try: relative = target.relative_to(self.root)
        except ValueError:
            self.error(source, f"path leaves deploy root: {value}"); return None
        if relative.parts and relative.parts[0] == "audio" or target.suffix.lower() in AUDIO_EXTENSIONS:
            self.audio += 1
            return None
        self.references.add((str(source), str(relative)))
        if not target.is_file(): self.error(source, f"missing local resource: {value} -> {relative}")
        return target

    def check_file_image(self, path):
        try:
            with path.open("rb") as handle: head = handle.read(512)
        except OSError as error:
            self.error(self.label(path), f"cannot read: {error}"); return
        mime = image_mime(head)
        extension = path.suffix.lower()
        if not mime and extension not in IMAGE_EXTENSIONS: return
        self.images += 1
        if not mime: self.error(self.label(path), "unknown image magic bytes")
        elif extension not in IMAGE_TYPES[mime]:
            self.error(self.label(path), f"magic {mime} disagrees with extension {extension or '(none)'}")

    def check_manifest(self):
        path = self.root / "textures/index.json"
        self.manifest = self.json_documents.get(path, {})
        if not isinstance(self.manifest, dict):
            self.error("textures/index.json", "manifest must be an object"); self.manifest = {}; return
        for identity, metadata in self.manifest.items():
            if identity == "decals":
                if not isinstance(metadata, dict): self.error("textures/index.json", "decals must be an object"); continue
                for decal_id, decal in metadata.items():
                    if not isinstance(decal, dict): self.error("textures/index.json", f"invalid decal {decal_id}"); continue
                    self.reference(f"textures/index.json decals.{decal_id}.file", decal.get("file"), path.parent, True)
                    if decal.get("normal"):
                        self.reference(f"textures/index.json decals.{decal_id}.normal", decal["normal"], path.parent, True)
                continue
            if not isinstance(metadata, dict) or "maps" not in metadata: continue
            maps = metadata["maps"]
            files = metadata.get("files", {})
            if not isinstance(maps, list) or not isinstance(files, dict):
                self.error("textures/index.json", f"invalid maps/files for {identity}"); continue
            for kind in maps:
                if not isinstance(kind, str): self.error("textures/index.json", f"invalid map name for {identity}"); continue
                self.reference(f"textures/index.json {identity}.{kind}", files.get(kind), path.parent / identity, True)
            for kind, filename in files.items():
                if kind not in maps:
                    self.reference(f"textures/index.json {identity}.files.{kind}", filename, path.parent / identity, True)

    def json_refs(self, path, document, keys=()):
        if isinstance(document, dict):
            for key, value in document.items(): self.json_refs(path, value, keys + (str(key),))
        elif isinstance(document, list):
            for index, value in enumerate(document): self.json_refs(path, value, keys + (str(index),))
        elif isinstance(document, str) and self.resource_path(document):
            if path == self.root / "textures/index.json": return  # ID-relative manifest handled explicitly.
            if keys and keys[-1] == "sourceLayout" and document.startswith("sources/"):
                self.notes.add("Build provenance sourceLayout is outside the deployed asset tree")
                return
            source = f"{self.label(path)} {'/'.join(keys)}"
            if "sharedImageBuffers" in keys or "externalDecals" in keys:
                base = self.root / "models"
            elif document.split("/", 1)[0] in ASSET_DIRS:
                base = self.root
            else: base = path.parent
            self.reference(source, document, base)

    def shared_buffers(self, path, document):
        bake = document.get("bake", {})
        compression = bake.get("compression", {}) if isinstance(bake, dict) else None
        if not isinstance(compression, dict):
            self.error(self.label(path), "bake/compression metadata must be an object"); return
        dependencies = compression.get("sharedImageBuffers", [])
        if not isinstance(dependencies, list):
            self.error(self.label(path), "sharedImageBuffers must be an array"); return
        for record in dependencies:
            source = f"{self.label(path)} sharedImageBuffers"
            if not isinstance(record, dict) or "uri" not in record:
                self.error(source, "invalid shared buffer record"); continue
            target = self.reference(source, record["uri"], self.root / "models", True)
            if not target or not target.is_file(): continue
            data = target.read_bytes()
            if "bytes" in record and record["bytes"] != len(data):
                self.error(source, f"shared buffer byte length changed: {record['uri']}")
            if "sha256" in record and record["sha256"] != hashlib.sha256(data).hexdigest():
                self.error(source, f"shared buffer SHA256 changed: {record['uri']}")

    def template_refs(self, source, value, base, allow_decal_alias=False):
        """Expand demo-specific templates without guessing a filename extension."""
        normalized = re.sub(r"^(?:\.\./)+", "", value)
        if normalized.startswith("textures/"):
            base = self.root
            match = re.fullmatch(r"textures/\$\{\w+\}/\$\{\w+\}(\.[a-z0-9]+)", normalized)
            if match:
                for identity, metadata in self.manifest.items():
                    if isinstance(metadata, dict) and "maps" in metadata:
                        for kind in metadata["maps"]:
                            self.reference(source, f"textures/{identity}/{kind}{match[1]}", base)
                return True
            match = re.fullmatch(r"textures/\$\{\w+\}/((?:albedo|normal|orm)\.[a-z0-9]+)", normalized)
            if match:
                for identity, metadata in self.manifest.items():
                    if isinstance(metadata, dict) and "maps" in metadata:
                        self.reference(source, f"textures/{identity}/{match[1]}", base)
                return True
            match = re.fullmatch(r"textures/decals/bullet_hole_\$\{\w+\}(\.[a-z0-9]+)", normalized)
            if match:
                for surface in ("concrete", "wood", "plaster", "metal"):
                    identity = f"bullet_hole_{surface}"
                    if self.decal_alias_adapter and allow_decal_alias:
                        filename = self.manifest.get("decals", {}).get(identity, {}).get("file")
                        if filename:
                            self.reference(source, f"textures/{filename}", self.root)
                            self.aliases += 1
                        else: self.error(source, f"missing manifest decal alias: {identity}")
                    else: self.reference(source, f"textures/decals/{identity}{match[1]}", self.root)
                return True
            # filenames/file/normal expressions use the validated manifest, not
            # a wildcard existence search that could hide a stale .jpg/.png URL.
            if "${" in normalized and any(word in normalized for word in ("${file}", "filename", ".file", ".normal", "files[")):
                self.notes.add("Material/decal filename expressions checked via textures/index.json")
                return True
        if re.fullmatch(r"models/props/\$\{\w+\}\.glb", normalized):
            for identity in self.prop_ids: self.reference(source, f"models/props/{identity}.glb", self.root)
            if not self.prop_ids: self.error(source, "dynamic props require AVAILABLE_PROPS inventory")
            return True
        return False

    def js_refs(self, path, source, line_offset=0):
        tokens = js_tokens(source)
        constants = {}

        def concatenate(parts):
            if not parts: return None
            output = []
            for index, token in enumerate(parts):
                if index % 2:
                    if token.value != "+": return None
                elif token.kind in ("string", "template"): output.append(token.value)
                elif token.kind == "identifier": output.append(constants.get(token.value, "${" + token.value + "}"))
                else: return None
            return "".join(output) if len(parts) % 2 else None

        # Fold literal prefixes (BASE) and simple concatenations (BASE + id + '/').
        for index in range(len(tokens) - 3):
            if tokens[index].value not in ("const", "let", "var"): continue
            if tokens[index + 1].kind != "identifier" or tokens[index + 2].value != "=": continue
            end = index + 3
            while end < len(tokens) and tokens[end].value not in (";", ",", ")"): end += 1
            value = concatenate(tokens[index + 3:end])
            if value is not None: constants[tokens[index + 1].value] = value

        for index, token in enumerate(tokens):
            if token.kind not in ("string", "template"):
                # Literal constants passed to a loader are references too.
                if token.kind != "identifier" or token.value not in constants: continue
                preceding = tokens[max(0, index - 2):index]
                if len(preceding) != 2 or preceding[-1].value != "(" or preceding[0].value not in ("fetch", "load", "loadAsync", "tex", "json", "readJSON", "assetUrl", "URL"):
                    continue
                value = constants[token.value]
            else: value = token.value
            location = f"{self.label(path)}:{token.line + line_offset}"
            imported = index > 0 and tokens[index - 1].value in ("from", "import")
            imported |= index > 1 and tokens[index - 2].value == "import" and tokens[index - 1].value == "("
            if imported:
                if path.suffix == ".mjs" and value.startswith("/") and not value.startswith("/bodycam-demo/"):
                    self.notes.add("Node harness absolute filesystem paths are outside the deployed asset tree")
                elif value.startswith((".", "/")): self.reference(location, value, path.parent, True)
                continue  # bare specifiers use importmap/npm, not filesystem paths.
            # Recover the whole adjacent concatenation before evaluating its URL.
            left = right = index
            while left >= 2 and tokens[left - 1].value == "+" and tokens[left - 2].kind in ("identifier", "string", "template"): left -= 2
            while right + 2 < len(tokens) and tokens[right + 1].value == "+" and tokens[right + 2].kind in ("identifier", "string", "template"): right += 2
            if left != right: value = concatenate(tokens[left:right + 1]) or value
            if "${" in value:
                # Only this known factory consumer reaches ManifestTextureLoader;
                # a direct TextureLoader elsewhere must retain strict paths.
                context = " ".join(t.value for t in tokens[max(0, left - 10):left])
                allow_alias = path == self.root / "js/weapon/effects.js" and "assets . texture . loadAsync ( assetUrl (" in context
                if self.template_refs(location, value, path.parent, allow_alias): continue
                if value.startswith(tuple(f"{folder}/" for folder in ASSET_DIRS)) and re.search(r"\.[a-z0-9]+$", value):
                    self.error(location, f"unsupported dynamic asset path: {value}")
                continue
            if not self.resource_path(value): continue
            first = value.split("/", 1)[0]
            if first in ASSET_DIRS: self.reference(location, value, self.root)
            elif path.suffix == ".mjs" and value.startswith("/") and not value.startswith("/bodycam-demo/"):
                self.notes.add("Node harness absolute filesystem paths are outside the deployed asset tree")
            elif value.startswith(("./", "../", "/")):
                url_call = index >= 2 and tokens[index - 2].value == "URL" and tokens[index - 1].value == "("
                url_base = tokens[index + 2].value if index + 2 < len(tokens) and tokens[index + 1].value == "," else None
                if url_call and url_base == "source" and path == self.root / "js/core/loaders.js" and self.decal_alias_adapter:
                    self.reference(location, value, self.root / "textures/decals")
                elif url_call and url_base and url_base != "import":
                    # A relative URL is resolved against its SECOND argument,
                    # not the module. Computed bases are audited at their data seam.
                    self.notes.add("Relative new URL components with computed bases require browser coverage")
                else: self.reference(location, value, path.parent)
            else:
                # A bare filename is a reference only in a loading/URL call.
                # e.g. 'level.json: HTTP...' and link.download are diagnostics.
                preceding = tokens[max(0, left - 5):left]
                consumers = {"fetch", "load", "loadAsync", "tex", "json", "readJSON", "assetUrl", "URL"}
                path_property = left >= 2 and tokens[left - 1].value == ":" and re.search(r"(?:url|path|file|src|href|lightmap)$", tokens[left - 2].value, re.I)
                if path_property or any(t.value in consumers for t in preceding) and any(t.value == "(" for t in preceding):
                    self.reference(location, value, path.parent)

    def check_gltf(self, path):
        label = self.label(path)
        self.glbs += 1
        try:
            binary = None
            if path.suffix.lower() == ".glb":
                raw = path.read_bytes()
                if len(raw) < 20 or struct.unpack_from("<4sII", raw) != (b"glTF", 2, len(raw)):
                    raise ValueError("invalid GLB header/version/length")
                cursor = 12
                document = None
                while cursor < len(raw):
                    if cursor + 8 > len(raw): raise ValueError("truncated GLB chunk header")
                    size, kind = struct.unpack_from("<II", raw, cursor)
                    cursor += 8
                    if cursor + size > len(raw) or size % 4: raise ValueError("invalid GLB chunk length")
                    chunk = raw[cursor:cursor + size]
                    if kind == 0x4E4F534A:
                        if document is not None: raise ValueError("duplicate GLB JSON chunk")
                        document = json.loads(chunk)
                    elif kind == 0x004E4942:
                        if binary is not None: raise ValueError("duplicate GLB BIN chunk")
                        binary = chunk
                    cursor += size
                if document is None: raise ValueError("missing GLB JSON chunk")
            else: document = json.loads(path.read_text())
            buffers = {}

            def buffer_data(index):
                if index in buffers: return buffers[index]
                if type(index) is not int or not 0 <= index < len(document.get("buffers", [])):
                    raise ValueError(f"invalid buffer index: {index}")
                definition = document.get("buffers", [])[index]
                uri = definition.get("uri")
                if uri:
                    if uri.startswith("data:"): data, _ = decode_data_uri(uri)
                    else:
                        target = self.reference(f"{label} buffers[{index}].uri", uri, path.parent, True)
                        if not target or not target.is_file(): return None
                        # SharedImageBuffers URI is a GLB used as raw HTTP bytes:
                        # the view's offset is absolute in that FILE, not its BIN.
                        data = target.read_bytes()
                else:
                    if index != 0 or binary is None: raise ValueError(f"buffer {index} has no URI/BIN payload")
                    data = binary
                if len(data) < definition.get("byteLength", 0): raise ValueError(f"buffer {index} shorter than declared byteLength")
                buffers[index] = data
                return data

            # All external dependencies matter, including buffers not used by images.
            for index, definition in enumerate(document.get("buffers", [])):
                if definition.get("uri"): buffer_data(index)
            for index, image in enumerate(document.get("images", [])):
                source = f"{label} images[{index}] {image.get('name', '')}".rstrip()
                try:
                    declared = image.get("mimeType")
                    if "uri" in image:
                        uri = image["uri"]
                        if uri.startswith("data:"):
                            data, uri_mime = decode_data_uri(uri)
                            declared = declared or uri_mime
                            if declared != uri_mime: self.error(source, f"mimeType {declared} disagrees with data URI {uri_mime}")
                        else:
                            target = self.reference(source, uri, path.parent, True)
                            if not target or not target.is_file(): continue
                            data = target.read_bytes()
                    elif "bufferView" in image:
                        view_index = image["bufferView"]
                        if type(view_index) is not int or not 0 <= view_index < len(document.get("bufferViews", [])):
                            raise ValueError(f"invalid image bufferView index: {view_index}")
                        view = document["bufferViews"][view_index]
                        buffer_index = view["buffer"]
                        data = buffer_data(buffer_index)
                        if data is None: continue
                        offset, length = view.get("byteOffset", 0), view["byteLength"]
                        declared_length = document["buffers"][buffer_index]["byteLength"]
                        if not isinstance(offset, int) or not isinstance(length, int) or offset < 0 or length <= 0 or offset + length > min(len(data), declared_length):
                            raise ValueError("image bufferView outside its buffer")
                        data = data[offset:offset + length]
                        if not declared: self.error(source, "embedded image missing mimeType")
                    else: raise ValueError("image has neither uri nor bufferView")
                    self.embedded += 1
                    detected = image_mime(data[:512])
                    if not detected: self.error(source, "unknown image magic bytes")
                    elif declared and declared != detected: self.error(source, f"mimeType {declared} disagrees with magic {detected}")
                except (ValueError, KeyError, IndexError, TypeError) as error:
                    self.error(source, str(error))
            # Lightmap extras contain demo-root paths, unlike glTF image/buffer URIs.
            self.json_refs(path, document.get("nodes", []), ("nodes",))
        except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
            self.error(label, str(error))

    def run(self):
        paths = sorted(p for p in self.root.rglob("*") if p.is_file() and p.relative_to(self.root).parts[0] != "audio")
        for path in paths:
            self.check_file_image(path)
            if path.suffix.lower() == ".json":
                try: self.json_documents[path] = json.loads(path.read_text())
                except (OSError, ValueError) as error: self.error(self.label(path), str(error))
        loader_path = self.root / "js/core/loaders.js"
        if loader_path.is_file():
            route = " ".join(token.value for token in js_tokens(loader_path.read_text()))
            required_route = (
                "export async function resolveDecalTextureUrl ( url )",
                "class ManifestTextureLoader extends TextureLoader",
                "super . loadAsync ( await resolveDecalTextureUrl ( url )",
                "texture : new ManifestTextureLoader ( manager )",
                "fetch ( indexUrl )", "decals ?. [ name ] ?. file",
            )
            self.decal_alias_adapter = all(component in route for component in required_route)
        self.check_manifest()
        inventory = self.root / "js/world/available-props.js"
        if inventory.is_file():
            self.prop_ids = [t.value for t in js_tokens(inventory.read_text()) if t.kind == "string"]
        for path, document in self.json_documents.items():
            self.json_refs(path, document)
            if isinstance(document, dict): self.shared_buffers(path, document)
        for path in paths:
            suffix = path.suffix.lower()
            if suffix in (".glb", ".gltf"): self.check_gltf(path)
            elif suffix in (".js", ".mjs"):
                try: self.js_refs(path, path.read_text())
                except (OSError, UnicodeError) as error: self.error(self.label(path), str(error))
            elif suffix == ".html":
                try:
                    parser = DemoHTML(self, path)
                    parser.feed(path.read_text())
                    parser.close()
                except (OSError, ValueError, UnicodeError) as error: self.error(self.label(path), str(error))
        print(f"Checked {len(paths)} files, {self.images} standalone images, {self.glbs} glTF files, "
              f"{self.embedded} glTF images, {len(self.references)} local references; "
              f"skipped {self.audio} audio and {self.external} external references.")
        if self.aliases: print(f"Resolved {self.aliases} weapon decal URLs through the loader's manifest alias adapter.")
        for note in sorted(self.notes): print(f"NOTE: {note}")
        for error in sorted(self.errors): print(f"ERROR: {error}", file=sys.stderr)
        print(f"{'FAIL' if self.errors else 'PASS'}: {len(self.errors)} error(s).")
        return bool(self.errors)


def decode_data_uri(uri):
    header, payload = uri.split(",", 1)
    mime = header[5:].split(";", 1)[0] or "text/plain"
    data = base64.b64decode(payload, validate=True) if ";base64" in header else unquote(payload).encode("latin1")
    return data, mime


class DemoHTML(HTMLParser):
    def __init__(self, audit, path):
        super().__init__(convert_charrefs=True)
        self.audit, self.path = audit, path
        self.script_type = None
        self.script_line = 0
        self.content = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        source = f"{self.audit.label(self.path)}:{self.getpos()[0]}"
        for key in (("src",) if tag in ("script", "img", "source", "video", "audio", "iframe") else ("href",) if tag in ("link", "a") else ()):
            value = attrs.get(key)
            if value and not value.startswith("#"):
                self.audit.reference(source, value, self.path.parent)
        if tag == "script":
            self.script_type = attrs.get("type", "text/javascript")
            self.script_line = self.getpos()[0] - 1
            self.content = []

    def handle_data(self, data):
        if self.script_type is not None: self.content.append(data)

    def handle_endtag(self, tag):
        if tag != "script" or self.script_type is None: return
        text = "".join(self.content)
        if self.script_type == "importmap":
            document = json.loads(text)
            for key, value in document.get("imports", {}).items():
                if not key.endswith("/"): self.audit.reference(f"{self.audit.label(self.path)} importmap", value, self.path.parent, True)
        elif self.script_type in ("module", "text/javascript", "application/javascript"):
            self.audit.js_refs(self.path, text, self.script_line)
        self.script_type = None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    default_root = Path(__file__).resolve().parents[3] / "public/bodycam-demo"
    parser.add_argument("--root", type=Path, default=default_root, help="deployed demo tree (default: public/bodycam-demo)")
    args = parser.parse_args()
    if not args.root.is_dir(): parser.error(f"root directory does not exist: {args.root}")
    return int(Audit(args.root).run())


if __name__ == "__main__":
    raise SystemExit(main())
