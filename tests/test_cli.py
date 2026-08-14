from __future__ import annotations

import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageCms


ROOT = Path(__file__).resolve().parent.parent
CONVERTER = ROOT / "scripts" / "make_hdr_image.py"
VIDEO_CONVERTER = ROOT / "scripts" / "make_hdr_video.py"
INSPECTOR = ROOT / "scripts" / "inspect_hdr_image.py"


class CliTests(unittest.TestCase):
    def test_converter_writes_progressive_pq_jpeg(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "logo.png"
            output = Path(temporary) / "logo-hdr.jpg"
            image = Image.new("RGB", (64, 64), "black")
            for x in range(20, 44):
                for y in range(20, 44):
                    image.putpixel((x, y), (255, 255, 255))
            image.save(source)

            conversion = subprocess.run(
                [sys.executable, str(CONVERTER), str(source), str(output), "--stops", "2.5"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(conversion.returncode, 0, conversion.stderr)

            with Image.open(output) as result:
                self.assertEqual(result.size, (64, 64))
                self.assertTrue(result.info.get("progressive") or result.info.get("progression"))
                profile_bytes = result.info.get("icc_profile")
                self.assertIsNotNone(profile_bytes)
                profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
                description = ImageCms.getProfileDescription(profile)
                self.assertTrue("2020" in description or "PQ" in description)

            inspection = subprocess.run(
                [sys.executable, str(INSPECTOR), str(output)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(inspection.returncode, 0, inspection.stdout)
            self.assertIn("delivery check: PASS", inspection.stdout)

    def test_converter_preserves_wide_transparent_input_dimensions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "transparent.png"
            output = Path(temporary) / "output.jpg"
            image = Image.new("RGBA", (192, 108), (255, 255, 255, 0))
            for x in range(16, 176):
                for y in range(38, 70):
                    image.putpixel((x, y), (255, 255, 255, 255))
            image.save(source)
            conversion = subprocess.run(
                [sys.executable, str(CONVERTER), str(source), str(output)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(conversion.returncode, 0, conversion.stderr)
            self.assertIn("fit: 192x108 -> 192x108", conversion.stdout)
            with Image.open(output) as result:
                self.assertEqual(result.size, (192, 108))
                self.assertLess(max(result.getpixel((4, 4))), 50)
                self.assertGreater(min(result.getpixel((96, 54))), 150)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is not installed")
    def test_video_converter_preserves_geometry_timing_and_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.mp4"
            output = Path(temporary) / "output.mp4"
            creation = subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-color_primaries", "bt709",
                    "-color_trc", "bt709", "-colorspace", "bt709", "-c:a", "aac", str(source),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(creation.returncode, 0, creation.stderr)
            conversion = subprocess.run(
                [sys.executable, str(VIDEO_CONVERTER), str(source), str(output), "--preset", "ultrafast", "--crf", "24", "--lut-size", "17"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(conversion.returncode, 0, conversion.stderr)
            inspection = subprocess.run(
                ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)],
                check=True,
                capture_output=True,
                text=True,
            )
            metadata = json.loads(inspection.stdout)
            video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
            audio = next(stream for stream in metadata["streams"] if stream["codec_type"] == "audio")
            self.assertEqual((video["width"], video["height"]), (320, 180))
            self.assertEqual(video["r_frame_rate"], "24/1")
            self.assertEqual(video["codec_name"], "hevc")
            self.assertEqual(video["profile"], "Main 10")
            self.assertEqual(video["pix_fmt"], "yuv420p10le")
            self.assertEqual(video["color_primaries"], "bt2020")
            self.assertEqual(video["color_transfer"], "smpte2084")
            self.assertEqual(video["color_space"], "bt2020nc")
            self.assertEqual(audio["codec_name"], "aac")
            self.assertAlmostEqual(float(metadata["format"]["duration"]), 1.0, delta=0.05)


if __name__ == "__main__":
    unittest.main()
