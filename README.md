<div align="center">
  <img src="public/favicon.svg" width="72" height="72" alt="SuperWhite logo">

  # SuperWhite

  **White, with headroom.** Turn a square SDR logo into a Rec.2020 PQ HDR JPEG—privately, in your browser or from the command line.

  [Open the workshop](https://arkane-o7.github.io/SuperWhite/) · [How it works](#how-it-works) · [CLI](#command-line)

  [![Verify](https://github.com/Arkane-o7/SuperWhite/actions/workflows/ci.yml/badge.svg)](https://github.com/Arkane-o7/SuperWhite/actions/workflows/ci.yml)
  [![MIT License](https://img.shields.io/badge/license-MIT-11110f.svg)](LICENSE)
</div>

![The SuperWhite website, showing the local HDR logo workbench](docs/superwhite-preview.png)

SuperWhite lifts only the near-white areas of a logo above HDR reference white.
Dark pixels and midtones stay composed. On a capable display and rendering path,
the result can emit physically more light than the ordinary white interface around
it; on SDR displays it tone-maps into an ordinary-looking logo.

> [!IMPORTANT]
> The observed LinkedIn behavior is undocumented and can change. Treat this as a
> visual experiment, keep the original SDR asset, and test the exact downloaded
> JPEG after every platform upload.

## The workshop

- **Local by construction.** The browser reads, converts, encodes, and downloads
  the logo without sending it to a server.
- **Real progressive JPEG encoding.** MozJPEG runs in WebAssembly through
  `@jsquash/jpeg`; SuperWhite then inserts the Rec.2020 PQ profile into JPEG APP2
  markers.
- **Live strength control.** Choose +1.0 to +3.9 stops and see the target and
  measured peak values before downloading.
- **Honest input checks.** Non-square assets and meaningful transparency are
  rejected instead of being silently flattened or cropped.
- **SDR/HDR comparison.** “Hold for SDR” uses the CSS `dynamic-range-limit`
  control in browsers that support it.

Everything needed for the static site is in the repository. There is no API,
database, analytics script, account system, or uploaded-image storage.

## Quick start

```bash
git clone https://github.com/Arkane-o7/SuperWhite.git
cd SuperWhite
npm install
npm run dev
```

Build and verify the production site:

```bash
npm test
npm run build
npm run preview
```

Node.js 22.12 or newer is required. The `main` branch deploys `dist/` to GitHub
Pages through [the included workflow](.github/workflows/pages.yml).

## Command line

The Python converter is useful for repeatable production work and preserves
Display P3 input handling when the source ICC profile identifies it.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python scripts/make_hdr_logo.py logo.png logo-hdr.jpg --stops 2.5
python scripts/inspect_hdr_logo.py logo-hdr.jpg
```

Expected inspection result:

```text
format: JPEG
progressive: yes
ICC description: Rec2020 Gamut with PQ Transfer
SuperWhite delivery check: PASS
```

### Strength guide

| Stops | Approximate target | Character |
| ---: | ---: | --- |
| +1.0 | 406 nit | Controlled |
| +2.0 | 812 nit | Clearly brighter |
| +2.5 | 1,148 nit | Strong starting point |
| +3.0 | 1,624 nit | Aggressive |
| +3.9 | 3,032 nit | Practical ceiling; displays will limit it |

Targets use 203 nit as graphics/reference white and double luminance for every
stop. A display never exceeds its physical peak: the OS/browser tone-maps the
requested highlight into available HDR headroom.

## How it works

```text
square SDR pixels
      │
      ├─ decode sRGB / Display P3 transfer curve
      ├─ convert linear light to Rec.2020
      ├─ smoothly lift only relative luminance above 0.55
      ├─ encode absolute luminance with SMPTE ST 2084 (PQ)
      ├─ write a 96-quality progressive JPEG
      └─ embed the Rec.2020 PQ ICC profile
```

The highlight mask uses a smoothstep from relative luminance 0.55 to 0.90. That
keeps a black background near reference behavior and blends antialiased logo
edges without a hard halo.

The browser build follows the same math as the Python implementation in
[`scripts/make_hdr_logo.py`](scripts/make_hdr_logo.py). Its JPEG encoder runs
locally, and [`injectIccProfile`](src/lib/hdr.ts) packages the profile directly
after the JPEG start marker according to the conventional ICC APP2 chunk layout.

## Input and delivery checklist

1. Start with a square PNG or JPEG. 400 × 400 is a useful social-logo size.
2. Flatten transparency onto a deliberate solid background.
3. Keep the brightest mark small; lifting the entire square is uncomfortable.
4. Start around +2.0 or +2.5 stops.
5. Open the downloaded JPEG directly in an HDR-capable viewer and display.
6. Upload that exact file. Do not re-export it through an editor or design tool.
7. Verify the platform copy on both HDR and SDR hardware.

## Browser and display behavior

HDR output needs an unbroken chain:

```text
HDR file + preserved profile + HDR-aware renderer + enabled HDR display
```

SuperWhite uses `@media (dynamic-range: high)` only as a capability hint. It
cannot prove that HDR is active, measure the viewer's physical peak luminance, or
predict what a social platform will do after upload.

- Apple documents that HDR rendering requires both ITU-R 2100 content and an
  EDR-capable output device, and added HDR web-image presentation controls in
  Safari 19: [What’s new in Safari and WebKit](https://developer.apple.com/videos/play/wwdc2025/233/?time=558).
- The CSS `dynamic-range-limit` property can constrain HDR media to reference
  white, but remains limited across browsers:
  [MDN reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/dynamic-range-limit).
- The original LinkedIn-surviving conversion and ICC asset come from
  [Adamodigi/linkedin-hdr-logo](https://github.com/Adamodigi/linkedin-hdr-logo).

## Repository map

```text
src/
  App.tsx               product interface and interactions
  lib/hdr.ts            Rec.2020/PQ math + JPEG ICC packaging
  lib/image.ts          browser file decoding and demo asset
scripts/
  make_hdr_logo.py      reproducible Python converter
  inspect_hdr_logo.py   delivery-profile verifier
public/
  rec2020pq.icc         bundled output profile
tests/
  test_cli.py           end-to-end CLI checks
.github/workflows/
  ci.yml                TypeScript, build, and Python verification
  pages.yml             GitHub Pages deployment
```

## Credits and license

The core method and ICC profile are adapted from
[Adamodigi/linkedin-hdr-logo](https://github.com/Adamodigi/linkedin-hdr-logo),
licensed under MIT. Browser JPEG encoding uses jSquash/MozJPEG. Full attribution
is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

SuperWhite is available under the [MIT License](LICENSE).
