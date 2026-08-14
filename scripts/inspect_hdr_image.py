#!/usr/bin/env python3
"""Inspect a SuperWhite HDR image for its key delivery properties."""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image, ImageCms


def inspect(path: Path) -> int:
    with Image.open(path) as image:
        profile_bytes = image.info.get("icc_profile")
        profile_name = "missing"
        if profile_bytes:
            profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
            profile_name = ImageCms.getProfileDescription(profile).strip()
        progressive = bool(image.info.get("progressive") or image.info.get("progression"))
        print(f"file: {path}")
        print(f"dimensions: {image.width}x{image.height}")
        print(f"format: {image.format}")
        print(f"progressive: {'yes' if progressive else 'no'}")
        print(f"ICC bytes: {len(profile_bytes) if profile_bytes else 0}")
        print(f"ICC description: {profile_name}")

    valid = bool(
        profile_bytes
        and progressive
        and ("2020" in profile_name or "PQ" in profile_name)
    )
    print(f"SuperWhite delivery check: {'PASS' if valid else 'FAIL'}")
    return 0 if valid else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    return inspect(parser.parse_args().image)


if __name__ == "__main__":
    raise SystemExit(main())
