#!/usr/bin/env python3
"""Convert any SDR image into a dimension-preserving Rec.2020 PQ HDR JPEG.

The conversion lifts near-white pixels by a chosen number of exposure stops,
PQ-encodes the result, and embeds a Rec.2020 PQ ICC profile. Aspect ratio is
preserved and transparency is flattened without adding padding or cropping.
The source image never leaves the machine.

This implementation is adapted from Adamodigi/linkedin-hdr-logo (MIT).
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageCms


SDR_WHITE = 203.0
MIN_STOPS = 1.0
MAX_STOPS = 3.9
ROOT = Path(__file__).resolve().parent.parent
ICC_PATH = ROOT / "public" / "rec2020pq.icc"

SRGB_TO_XYZ = np.array(
    [
        [0.41239, 0.35758, 0.18048],
        [0.21264, 0.71517, 0.07219],
        [0.01933, 0.11919, 0.95053],
    ]
)
P3_TO_XYZ = np.array(
    [
        [0.48657, 0.26567, 0.19822],
        [0.22897, 0.69174, 0.07929],
        [0.00000, 0.04511, 1.04394],
    ]
)
XYZ_TO_2020 = np.array(
    [
        [1.71665, -0.35567, -0.25337],
        [-0.66668, 1.61648, 0.01577],
        [0.01764, -0.04277, 0.94210],
    ]
)


def srgb_eotf(value: np.ndarray) -> np.ndarray:
    """Decode sRGB/P3 transfer-encoded values into linear light."""

    return np.where(
        value <= 0.04045,
        value / 12.92,
        ((value + 0.055) / 1.055) ** 2.4,
    )


def pq_inverse_eotf(nits: np.ndarray) -> np.ndarray:
    """Encode absolute luminance with SMPTE ST 2084 (PQ)."""

    m1, m2 = 2610 / 16384, 2523 / 4096 * 128
    c1, c2, c3 = 3424 / 4096, 2413 / 4096 * 32, 2392 / 4096 * 32
    normalized = np.clip(nits / 10_000.0, 0, 1)
    return (
        (c1 + c2 * normalized**m1) / (1 + c3 * normalized**m1)
    ) ** m2


def source_gamut(image: Image.Image) -> tuple[np.ndarray, str]:
    """Choose an RGB-to-XYZ matrix from the embedded source profile."""

    icc_bytes = image.info.get("icc_profile")
    if not icc_bytes:
        return SRGB_TO_XYZ, "sRGB (assumed)"

    try:
        profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_bytes))
        description = ImageCms.getProfileDescription(profile).strip()
    except Exception:
        return SRGB_TO_XYZ, "sRGB (unreadable source profile)"

    if "P3" in description:
        return P3_TO_XYZ, description
    if "2020" in description or "PQ" in description:
        raise ValueError(
            f"input already looks HDR-encoded ({description}); use the original SDR image"
        )
    return SRGB_TO_XYZ, description or "sRGB"


def normalize_image(image: Image.Image) -> tuple[Image.Image, tuple[int, int]]:
    """Flatten transparency without resizing, padding, or cropping."""

    original_size = image.size
    rgba = image.convert("RGBA")
    canvas = Image.new("RGB", rgba.size, (11, 11, 11))
    canvas.paste(rgba, (0, 0), rgba)
    return canvas, original_size


def convert(input_path: Path, output_path: Path, stops: float) -> dict[str, object]:
    if not MIN_STOPS <= stops <= MAX_STOPS:
        raise ValueError(f"stops must be between {MIN_STOPS:g} and {MAX_STOPS:g}")
    if not ICC_PATH.exists():
        raise FileNotFoundError(f"bundled ICC profile is missing: {ICC_PATH}")

    with Image.open(input_path) as image:
        source_matrix, source_name = source_gamut(image)
        normalized, original_size = normalize_image(image)
        encoded = np.asarray(normalized, dtype=np.float64) / 255.0

    linear = srgb_eotf(encoded)
    conversion_matrix = XYZ_TO_2020 @ source_matrix
    rec2020 = np.clip(
        np.einsum("...j,ij->...i", linear, conversion_matrix, optimize=True),
        0,
        None,
    )
    luminance = (
        0.2627 * rec2020[..., 0]
        + 0.6780 * rec2020[..., 1]
        + 0.0593 * rec2020[..., 2]
    )
    ramp = np.clip((luminance - 0.55) / (0.90 - 0.55), 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    gain = 1.0 + (2.0**stops - 1.0) * ramp**1.5

    nits = rec2020 * SDR_WHITE * gain[..., None]
    output = np.clip(np.round(pq_inverse_eotf(nits) * 255), 0, 255).astype(
        np.uint8
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    icc = ICC_PATH.read_bytes()
    Image.fromarray(output).save(
        output_path,
        quality=96,
        subsampling=0,
        progressive=True,
        icc_profile=icc,
    )

    return {
        "source_gamut": source_name,
        "target_peak": round(SDR_WHITE * 2**stops),
        "actual_peak": round(float(nits.max()), 1),
        "boosted_percent": round(float((gain > 1.01).mean() * 100), 1),
        "original_size": f"{original_size[0]}x{original_size[1]}",
        "output_size": f"{output.shape[1]}x{output.shape[0]}",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Make near-white image pixels render as HDR highlights without changing geometry."
    )
    parser.add_argument("input", type=Path, help="any SDR image Pillow can decode")
    parser.add_argument("output", type=Path, help="output path ending in .jpg")
    parser.add_argument(
        "--stops",
        type=float,
        default=2.5,
        help="highlight exposure from +1.0 to +3.9 stops (default: 2.5)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.output.suffix.lower() not in {".jpg", ".jpeg"}:
        print("ERROR: output must end in .jpg or .jpeg", file=sys.stderr)
        return 2

    try:
        result = convert(args.input, args.output, args.stops)
    except (FileNotFoundError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    print(
        f"wrote {args.output} | source: {result['source_gamut']} | "
        f"fit: {result['original_size']} -> {result['output_size']} | "
        f"target: ~{result['target_peak']} nits | "
        f"measured: {result['actual_peak']} nits | "
        f"boosted: {result['boosted_percent']}%"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
