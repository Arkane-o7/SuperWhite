from __future__ import annotations

import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageCms


ROOT = Path(__file__).resolve().parent.parent
CONVERTER = ROOT / "scripts" / "make_hdr_logo.py"
INSPECTOR = ROOT / "scripts" / "inspect_hdr_logo.py"


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

    def test_converter_rejects_transparency(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "transparent.png"
            output = Path(temporary) / "output.jpg"
            Image.new("RGBA", (20, 20), (255, 255, 255, 0)).save(source)
            conversion = subprocess.run(
                [sys.executable, str(CONVERTER), str(source), str(output)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(conversion.returncode, 2)
            self.assertIn("transparency", conversion.stderr)


if __name__ == "__main__":
    unittest.main()
