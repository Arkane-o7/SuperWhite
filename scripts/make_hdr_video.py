#!/usr/bin/env python3
"""Convert an SDR video to dimension-preserving HDR10 HEVC.

The converter keeps the source resolution, aspect ratio, frame rate, duration,
and audio timing. It raises highlights with the same soft exposure ramp used by
SuperWhite's still-image converter, encodes the result as 10-bit Rec.2020/PQ,
and writes HDR10 mastering metadata into an MP4 container.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


SDR_WHITE = 203.0
MIN_STOPS = 1.0
MAX_STOPS = 3.9
BT709_TO_XYZ = (
    (0.41239, 0.35758, 0.18048),
    (0.21264, 0.71517, 0.07219),
    (0.01933, 0.11919, 0.95053),
)
XYZ_TO_BT2020 = (
    (1.71665, -0.35567, -0.25337),
    (-0.66668, 1.61648, 0.01577),
    (0.01764, -0.04277, 0.94210),
)


def multiply_matrices(
    left: tuple[tuple[float, ...], ...], right: tuple[tuple[float, ...], ...]
) -> tuple[tuple[float, ...], ...]:
    return tuple(
        tuple(sum(left[row][k] * right[k][column] for k in range(3)) for column in range(3))
        for row in range(3)
    )


BT709_TO_BT2020 = multiply_matrices(XYZ_TO_BT2020, BT709_TO_XYZ)


def bt709_eotf(value: float) -> float:
    return value / 4.5 if value < 0.081 else ((value + 0.099) / 1.099) ** (1 / 0.45)


def pq_encode(nits: float) -> float:
    m1, m2 = 2610 / 16384, 2523 / 4096 * 128
    c1, c2, c3 = 3424 / 4096, 2413 / 4096 * 32, 2392 / 4096 * 32
    normalized = max(0.0, min(nits / 10_000.0, 1.0))
    powered = normalized**m1
    return ((c1 + c2 * powered) / (1 + c3 * powered)) ** m2


def transform(red: float, green: float, blue: float, stops: float) -> tuple[float, float, float]:
    linear_709 = (bt709_eotf(red), bt709_eotf(green), bt709_eotf(blue))
    linear_2020 = tuple(
        max(0.0, sum(BT709_TO_BT2020[row][column] * linear_709[column] for column in range(3)))
        for row in range(3)
    )
    luminance = 0.2627 * linear_2020[0] + 0.6780 * linear_2020[1] + 0.0593 * linear_2020[2]
    ramp = max(0.0, min((luminance - 0.55) / (0.90 - 0.55), 1.0))
    ramp = ramp * ramp * (3 - 2 * ramp)
    gain = 1.0 + (2.0**stops - 1.0) * ramp**1.5
    return tuple(pq_encode(channel * SDR_WHITE * gain) for channel in linear_2020)


def write_cube(path: Path, stops: float, size: int) -> None:
    with path.open("w", encoding="ascii") as cube:
        cube.write(f'TITLE "SuperWhite +{stops:.1f} stops"\n')
        cube.write(f"LUT_3D_SIZE {size}\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n")
        denominator = size - 1
        # The .cube format stores red as the fastest-changing component.
        for blue_index in range(size):
            for green_index in range(size):
                for red_index in range(size):
                    values = transform(
                        red_index / denominator,
                        green_index / denominator,
                        blue_index / denominator,
                        stops,
                    )
                    cube.write("{:.8f} {:.8f} {:.8f}\n".format(*values))


def probe(path: Path, ffprobe: str) -> dict[str, object]:
    command = [
        ffprobe,
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def video_stream(metadata: dict[str, object]) -> dict[str, object]:
    for stream in metadata.get("streams", []):
        if isinstance(stream, dict) and stream.get("codec_type") == "video":
            return stream
    raise ValueError("input does not contain a video stream")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert any SDR video to dimension-preserving Rec.2020/PQ HDR10 HEVC."
    )
    parser.add_argument("input", type=Path, help="input video in any format FFmpeg can decode")
    parser.add_argument("output", type=Path, help="output .mp4 path")
    parser.add_argument(
        "--stops",
        type=float,
        default=2.5,
        help="highlight exposure from +1.0 to +3.9 stops (default: 2.5)",
    )
    parser.add_argument("--crf", type=int, default=18, help="x265 quality (default: 18)")
    parser.add_argument("--preset", default="medium", help="x265 preset (default: medium)")
    parser.add_argument(
        "--lut-size",
        type=int,
        default=33,
        choices=(17, 33, 65),
        help=argparse.SUPPRESS,
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        print("ERROR: FFmpeg and ffprobe must be installed and available on PATH", file=sys.stderr)
        return 2
    if not args.input.is_file():
        print(f"ERROR: input does not exist: {args.input}", file=sys.stderr)
        return 2
    if args.output.suffix.lower() != ".mp4":
        print("ERROR: output must end in .mp4", file=sys.stderr)
        return 2
    if not MIN_STOPS <= args.stops <= MAX_STOPS:
        print(f"ERROR: stops must be between {MIN_STOPS:g} and {MAX_STOPS:g}", file=sys.stderr)
        return 2

    try:
        metadata = probe(args.input, ffprobe)
        stream = video_stream(metadata)
    except (subprocess.CalledProcessError, json.JSONDecodeError, ValueError) as error:
        print(f"ERROR: could not inspect input video: {error}", file=sys.stderr)
        return 2

    transfer = str(stream.get("color_transfer", "unknown"))
    if transfer in {"smpte2084", "arib-std-b67"}:
        print("ERROR: input is already HDR; use the original SDR source", file=sys.stderr)
        return 2

    unknown_color = any(
        str(stream.get(field, "unknown")) in {"unknown", "unspecified", "None", ""}
        for field in ("color_space", "color_transfer", "color_primaries")
    )
    target_peak = max(1, round(SDR_WHITE * 2**args.stops))
    max_fall = min(target_peak, 400)
    mastering = (
        "G(8500,39850)B(6550,2300)R(35400,14600)"
        f"WP(15635,16450)L({target_peak * 10_000},1)"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="superwhite-") as temporary:
        cube_path = Path(temporary) / "superwhite.cube"
        write_cube(cube_path, args.stops, args.lut_size)
        assume_709 = (
            "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,"
            if unknown_color
            else ""
        )
        filter_chain = (
            f"{assume_709}"
            "colorspace=all=bt709:range=tv:format=yuv444p10,"
            "format=gbrp16le,"
            f"lut3d=file='{cube_path}':interp=tetrahedral,"
            "scale=out_color_matrix=bt2020:out_range=tv:flags=bicubic+accurate_rnd,"
            "format=yuv420p10le,"
            "setparams=range=tv:color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc"
        )
        x265_parameters = ":".join(
            (
                "hdr10=1",
                "hdr10-opt=1",
                "repeat-headers=1",
                "colorprim=bt2020",
                "transfer=smpte2084",
                "colormatrix=bt2020nc",
                f"master-display={mastering}",
                f"max-cll={target_peak},{max_fall}",
            )
        )
        command = [
            ffmpeg,
            "-hide_banner",
            "-y",
            "-i",
            str(args.input),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-vf",
            filter_chain,
            "-c:v",
            "libx265",
            "-preset",
            args.preset,
            "-crf",
            str(args.crf),
            "-pix_fmt",
            "yuv420p10le",
            "-tag:v",
            "hvc1",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            "smpte2084",
            "-colorspace",
            "bt2020nc",
            "-color_range",
            "tv",
            "-x265-params",
            x265_parameters,
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(args.output),
        ]
        print(
            f"converting {stream.get('width')}x{stream.get('height')} video at +{args.stops:.1f} stops "
            f"to ~{target_peak} nit HDR10...",
            flush=True,
        )
        result = subprocess.run(command)
        if result.returncode != 0:
            print("ERROR: FFmpeg conversion failed", file=sys.stderr)
            return result.returncode

    print(f"wrote {args.output} | geometry and timing preserved | 10-bit HEVC | Rec.2020 / PQ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
