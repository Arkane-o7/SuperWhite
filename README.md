<p align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="SuperWhite mark">
</p>

<h1 align="center">SuperWhite</h1>

<p align="center">
  <strong>Any shape. Still or moving.</strong><br>
  Convert SDR images and videos into dimension-preserving Rec.2020/PQ HDR media.
</p>

<p align="center">
  <a href="https://arkane-o7.github.io/SuperWhite/">Open the website</a>
</p>

SuperWhite adds real HDR highlight brightness to media without changing its
shape. A 1920 × 1080 video remains 1920 × 1080. Portrait footage remains
portrait. Frame rate, duration, and audio timing are preserved.

The brightest pixels can then render above SDR reference white on a compatible
HDR display. On SDR displays, compatible software tone-maps the result.

## What it accepts

- Images in any format the browser or Pillow can decode
- Videos in any format FFmpeg can decode, including MP4, MOV, MKV, WebM, AVI,
  MTS, and M2TS
- Landscape, portrait, ultrawide, square, or any other source aspect ratio

There is no square requirement, no crop step, and no padding step.

## Use the website

Image conversion works directly on the public static website and never sends
the image to a server.

Video conversion uses native FFmpeg. Run the same interface locally to enable
video uploads:

```bash
git clone https://github.com/Arkane-o7/SuperWhite.git
cd SuperWhite
npm install
python3 -m pip install -r requirements.txt
brew install ffmpeg
npm run local
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173), drop in a video, set
the exposure, and download the HDR10 MP4. The upload travels only from your
browser to the FFmpeg process on the same machine.

The public GitHub Pages build cannot execute native FFmpeg, so it shows the
local-runner instruction when a video is selected instead of pretending it can
produce a standards-correct HDR video in-browser.

## Command line

### Image

```bash
python scripts/make_hdr_image.py input.png output-hdr.jpg --stops 2.5
python scripts/inspect_hdr_image.py output-hdr.jpg
```

The image converter preserves the exact aspect ratio and dimensions, flattens
transparency, converts linear light into Rec.2020,
PQ-encodes the result, and embeds the bundled Rec.2020/PQ ICC profile.

### Video

```bash
python scripts/make_hdr_video.py input.mp4 output-hdr.mp4 --stops 2.5
```

Useful controls:

```bash
python scripts/make_hdr_video.py input.mov output-hdr.mp4 \
  --stops 3.0 \
  --crf 18 \
  --preset medium
```

The output is:

- The same width, height, display aspect ratio, frame rate, and duration
- 10-bit HEVC Main 10 in an MP4 container with the `hvc1` compatibility tag
- Rec.2020 primaries with SMPTE ST 2084 (PQ)
- HDR10 mastering-display and MaxCLL/MaxFALL metadata
- Original audio timing, encoded as AAC for broad MP4 compatibility

Already-HDR PQ or HLG input is rejected to avoid double conversion.

## Exposure

`--stops` controls the maximum highlight lift. It does not resize the media.

| Stops | Approximate target | Character |
|---:|---:|---|
| +1.0 | 406 nit | restrained |
| +2.0 | 812 nit | visible |
| +2.5 | 1,148 nit | strong |
| +3.0 | 1,624 nit | intense |
| +3.9 | 3,027 nit | extreme |

The lift uses a smooth luminance threshold, so dark and midtone areas remain
close to their source behavior while highlights receive the HDR headroom.

## How it works

```text
SDR image                         SDR video + audio
    │                                     │
    ├─ preserve source geometry           ├─ preserve geometry and timing
    ├─ linearize sRGB                     ├─ normalize SDR color to BT.709
    ├─ convert to Rec.2020                 ├─ apply the SuperWhite 3D LUT
    ├─ selectively lift highlights        ├─ encode 10-bit Rec.2020/PQ HEVC
    ├─ PQ encode                          ├─ write HDR10 metadata
    └─ embed PQ ICC profile               └─ retain audio timing in MP4
```

## Development

```bash
npm install
python3 -m pip install -r requirements.txt
npm test
python3 -m unittest discover -s tests
npm run build
```

`npm run dev` starts the image-only Vite development server. `npm run local`
builds the site and starts the local FFmpeg-enabled server.

## Project layout

```text
src/                          React interface and browser image converter
scripts/make_hdr_image.py     dimension-preserving HDR still converter
scripts/make_hdr_video.py     dimension-preserving HDR10 video converter
scripts/superwhite_server.py  local upload UI + FFmpeg bridge
public/rec2020pq.icc          bundled Rec.2020/PQ delivery profile
tests/                        image and video conversion checks
```

## Compatibility

The visible effect needs the entire chain: HDR file, metadata that survives the
destination, HDR-aware player/browser/OS, and an HDR-capable display. Platform
image and video processing can strip or rewrite HDR metadata, and behavior can
change without notice.

The still-image method and profile are adapted from
[Adamodigi/linkedin-hdr-logo](https://github.com/Adamodigi/linkedin-hdr-logo)
under the MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
