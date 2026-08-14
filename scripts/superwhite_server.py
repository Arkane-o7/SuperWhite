#!/usr/bin/env python3
"""Serve the SuperWhite site locally with native FFmpeg video conversion."""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
VIDEO_CONVERTER = ROOT / "scripts" / "make_hdr_video.py"
MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024


class SuperWhiteHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(DIST), **kwargs)

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/api/health":
            ready = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
            self.send_json(200 if ready else 503, {"video": ready})
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/convert/video":
            self.send_error(404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0 or content_length > MAX_UPLOAD_BYTES:
            self.send_json(413, {"error": "The upload is empty or larger than 8 GB."})
            return

        query = parse_qs(parsed.query)
        try:
            stops = float(query.get("stops", ["2.5"])[0])
        except ValueError:
            self.send_json(400, {"error": "Invalid exposure value."})
            return
        original_name = Path(unquote(query.get("name", ["input.mp4"])[0])).name
        suffix = Path(original_name).suffix or ".video"

        with tempfile.TemporaryDirectory(prefix="superwhite-upload-") as temporary:
            input_path = Path(temporary) / f"input{suffix}"
            output_path = Path(temporary) / "superwhite-hdr.mp4"
            remaining = content_length
            with input_path.open("wb") as destination:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    destination.write(chunk)
                    remaining -= len(chunk)
            if remaining:
                self.send_json(400, {"error": "The upload ended before the complete file arrived."})
                return

            command = [
                sys.executable,
                str(VIDEO_CONVERTER),
                str(input_path),
                str(output_path),
                "--stops",
                str(stops),
            ]
            conversion = subprocess.run(command, capture_output=True, text=True)
            if conversion.returncode != 0 or not output_path.exists():
                detail = conversion.stderr.strip().splitlines()
                self.send_json(
                    422,
                    {"error": detail[-1] if detail else "FFmpeg could not convert this video."},
                )
                return

            size = output_path.stat().st_size
            output_name = f"{Path(original_name).stem or 'video'}-superwhite-{str(stops).replace('.', '-')}stops.mp4"
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.types_map.get(".mp4", "video/mp4"))
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f'attachment; filename="{output_name}"')
            self.end_headers()
            with output_path.open("rb") as source:
                shutil.copyfileobj(source, self.wfile)


def main() -> int:
    if not DIST.exists():
        print("ERROR: dist/ is missing. Run npm run build first.", file=sys.stderr)
        return 2
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("ERROR: FFmpeg is required for local video conversion.", file=sys.stderr)
        return 2

    server = ThreadingHTTPServer(("127.0.0.1", 4173), SuperWhiteHandler)
    print("SuperWhite is running at http://127.0.0.1:4173")
    print("Image conversion stays in-browser; video conversion stays on this machine.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SuperWhite.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
