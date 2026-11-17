#!/usr/bin/env python3
"""Static and Range-capable HTTP server for stem-stage."""

from __future__ import annotations

import argparse
import functools
import ipaddress
import json
import mimetypes
import re
import socket
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SITE_DIR = PROJECT_ROOT / "site"
DEFAULT_PORT = 8788
CHUNK_SIZE = 64 * 1024

MIME_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
}

NO_CACHE_EXTENSIONS = {".json", ".html", ".htm", ".js", ".mjs", ".css"}
CACHEABLE_EXTENSIONS = {".mp3", ".wav", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2", ".ico"}

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def detect_lan_ip() -> str:
    """Detect the active IPv4 LAN address, preferring 192.168.x.x / 10.x.x.x."""
    candidates: list[str] = []
    for target in (("192.168.178.1", 80), ("1.1.1.1", 80), ("8.8.8.8", 80)):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.settimeout(0.3)
            sock.connect(target)
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127.") and ip not in candidates:
                candidates.append(ip)
        except OSError:
            continue
        finally:
            sock.close()

    for prefix in ("192.168.", "10."):
        for ip in candidates:
            if ip.startswith(prefix):
                return ip

    for ip in candidates:
        try:
            addr = ipaddress.IPv4Address(ip)
            if addr.is_private and not addr.is_loopback:
                return ip
        except ValueError:
            continue

    return candidates[0] if candidates else "127.0.0.1"


def guess_mime_type(file_path: Path) -> str:
    """Return an explicit MIME type for web, audio, and vendor assets."""
    suffix = file_path.suffix.lower()
    if suffix in MIME_TYPES:
        return MIME_TYPES[suffix]
    guessed, _ = mimetypes.guess_type(str(file_path))
    return guessed or "application/octet-stream"


def determine_cache_control(file_path: Path, serve_root: Path) -> str:
    """Return no-cache for app code/manifests and max-age=3600 for audio/vendor assets."""
    try:
        rel_parts = file_path.resolve().relative_to(serve_root).parts
    except ValueError:
        rel_parts = ()

    if rel_parts and rel_parts[0] == "vendor":
        return "public, max-age=3600"

    suffix = file_path.suffix.lower()
    if suffix in CACHEABLE_EXTENSIONS:
        return "public, max-age=3600"
    if suffix in NO_CACHE_EXTENSIONS:
        return "no-cache"
    return "no-cache"


def parse_range_header(
    header_value: str, file_size: int
) -> tuple[str, tuple[int, int] | None]:
    """Parse an HTTP Range header.

    Returns ("ok", (start, end)), ("ignore", None), or ("unsatisfiable", None).
    """
    value = header_value.strip()
    match = RANGE_RE.match(value)
    if not match:
        return ("ignore", None)

    start_str, end_str = match.groups()
    if not start_str and not end_str:
        return ("ignore", None)

    if file_size <= 0:
        return ("unsatisfiable", None)

    if not start_str:
        suffix_len = int(end_str)
        if suffix_len <= 0:
            return ("unsatisfiable", None)
        start = max(0, file_size - suffix_len)
        end = file_size - 1
        return ("ok", (start, end))

    start = int(start_str)
    if start >= file_size:
        return ("unsatisfiable", None)

    end = int(end_str) if end_str else file_size - 1
    if end < start:
        return ("unsatisfiable", None)

    end = min(end, file_size - 1)
    return ("ok", (start, end))


class RangeRequestHandler(SimpleHTTPRequestHandler):
    """HTTP request handler supporting byte-range requests and /api/network-info."""

    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        self._serve_request(send_body=True)

    def do_HEAD(self) -> None:
        self._serve_request(send_body=False)

    def _serve_request(self, *, send_body: bool) -> None:
        parsed_url = urlsplit(self.path)
        if parsed_url.path == "/api/network-info":
            self._serve_network_info(send_body=send_body)
            return

        serve_root = Path(self.directory).resolve()
        fs_path = Path(self.translate_path(self.path))

        try:
            resolved_path = fs_path.resolve()
            if not resolved_path.is_relative_to(serve_root):
                self.send_error(HTTPStatus.FORBIDDEN, "Access denied")
                return
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        if resolved_path.is_dir():
            if not parsed_url.path.endswith("/"):
                redirect_target = f"{parsed_url.path}/"
                if parsed_url.query:
                    redirect_target = f"{redirect_target}?{parsed_url.query}"
                self.send_response(HTTPStatus.MOVED_PERMANENTLY)
                self.send_header("Location", redirect_target)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

            index_file = next(
                (resolved_path / name for name in ("index.html", "index.htm") if (resolved_path / name).is_file()),
                None,
            )
            if index_file is None:
                listing = self.list_directory(str(resolved_path))
                if listing is not None:
                    try:
                        if send_body:
                            self.copyfile(listing, self.wfile)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    finally:
                        listing.close()
                return
            resolved_path = index_file

        if not resolved_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        self._serve_file(resolved_path, serve_root, send_body=send_body)

    def _serve_network_info(self, *, send_body: bool) -> None:
        lan_ip = detect_lan_ip()
        port = self.server.server_port
        payload = {
            "lanIp": lan_ip,
            "port": port,
            "suggestedUrl": f"http://{lan_ip}:{port}/",
        }
        body = (json.dumps(payload, indent=2) + "\n").encode("utf-8")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if send_body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _serve_file(self, file_path: Path, serve_root: Path, *, send_body: bool) -> None:
        try:
            stat = file_path.stat()
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return

        file_size = stat.st_size
        content_type = guess_mime_type(file_path)
        cache_control = determine_cache_control(file_path, serve_root)
        last_modified = self.date_time_string(stat.st_mtime)

        range_header = self.headers.get("Range")
        if range_header:
            status, byte_range = parse_range_header(range_header, file_size)
            if status == "unsatisfiable":
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", "0")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                return
            if status == "ok" and byte_range is not None:
                start, end = byte_range
                length = end - start + 1
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Last-Modified", last_modified)
                self.send_header("Cache-Control", cache_control)
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                if send_body:
                    self._stream_file_range(file_path, start, length)
                return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", last_modified)
        self.send_header("Cache-Control", cache_control)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if send_body and file_size > 0:
            self._stream_file_range(file_path, 0, file_size)

    def _stream_file_range(self, file_path: Path, offset: int, length: int) -> None:
        remaining = length
        try:
            with file_path.open("rb") as handle:
                if offset > 0:
                    handle.seek(offset)
                while remaining > 0:
                    chunk = handle.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    """Threaded HTTP server allowing immediate address reuse."""

    allow_reuse_address = True
    daemon_threads = True


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve stem-stage static site with HTTP Range support and /api/network-info."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"TCP port to listen on (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_SITE_DIR,
        help=f"Directory to serve (default: {DEFAULT_SITE_DIR})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    serve_dir = args.dir.resolve()
    if not serve_dir.is_dir():
        print(f"Error: serve directory does not exist: {serve_dir}", file=sys.stderr)
        return 1

    handler_cls = functools.partial(RangeRequestHandler, directory=str(serve_dir))
    server = ReusableThreadingHTTPServer(("0.0.0.0", args.port), handler_cls)
    bound_port = server.server_port
    lan_ip = detect_lan_ip()
    print(f"Serving {serve_dir}")
    print(f"  Local:   http://127.0.0.1:{bound_port}/")
    print(f"  Network: http://{lan_ip}:{bound_port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
