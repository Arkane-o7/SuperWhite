import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_STOPS,
  MAX_STOPS,
  MIN_STOPS,
  convertToHdr,
  encodeHdrJpeg,
  hasMeaningfulTransparency,
  makeOutputName,
  peakNitsForStops,
  type ConvertedPixels,
  type PixelBuffer,
} from './lib/hdr'
import { fileToPixels, makeDemoPixels, pixelsToSdrUrl } from './lib/image'

type ConversionState = 'working' | 'ready' | 'error'

const GithubIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
    <path
      fill="currentColor"
      d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.24.7-3.92-1.37-3.92-1.37-.53-1.35-1.3-1.71-1.3-1.71-1.06-.73.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.59-.3-5.31-1.3-5.31-5.68 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.07 0 0 .98-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.18-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.07.75.81 1.2 1.84 1.2 3.1 0 4.39-2.73 5.38-5.33 5.67.42.36.79 1.08.79 2.18v3.24c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z"
    />
  </svg>
)

const ArrowIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
    <path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

const DownloadIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18">
    <path d="M10 2v10m0 0 4-4m-4 4L6 8M3 15.5h14" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

function App() {
  const [source, setSource] = useState<PixelBuffer>(() => makeDemoPixels())
  const [sourceName, setSourceName] = useState('superwhite-demo.png')
  const [stops, setStops] = useState(DEFAULT_STOPS)
  const [converted, setConverted] = useState<ConvertedPixels | null>(null)
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null)
  const [outputUrl, setOutputUrl] = useState('')
  const [conversionState, setConversionState] = useState<ConversionState>('working')
  const [message, setMessage] = useState('Preparing the HDR preview…')
  const [dragging, setDragging] = useState(false)
  const [limited, setLimited] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const sourceUrl = useMemo(() => pixelsToSdrUrl(source), [source])
  const hdrCapable = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(dynamic-range: high)').matches,
    [],
  )

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setConversionState('working')
      setMessage('Encoding a progressive HDR JPEG locally…')
      try {
        const nextPixels = convertToHdr(source, stops)
        const nextBlob = await encodeHdrJpeg(nextPixels)
        if (cancelled) return
        const nextUrl = URL.createObjectURL(nextBlob)
        setOutputUrl((current) => {
          if (current) URL.revokeObjectURL(current)
          return nextUrl
        })
        setConverted(nextPixels)
        setOutputBlob(nextBlob)
        setConversionState('ready')
        setMessage('Ready. The Rec.2020 PQ profile is embedded in the download.')
      } catch (error) {
        if (cancelled) return
        setConversionState('error')
        setMessage(error instanceof Error ? error.message : 'The image could not be converted.')
      }
    }, 80)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [source, stops])

  useEffect(
    () => () => {
      if (outputUrl) URL.revokeObjectURL(outputUrl)
    },
    [outputUrl],
  )

  async function acceptFile(file?: File) {
    if (!file) return
    setConversionState('working')
    setMessage('Reading the logo locally…')
    try {
      const pixels = await fileToPixels(file)
      if (hasMeaningfulTransparency(pixels)) {
        throw new Error('This logo has transparency. Flatten it onto a solid background first.')
      }
      setSource(pixels)
      setSourceName(file.name)
    } catch (error) {
      setConversionState('error')
      setMessage(error instanceof Error ? error.message : 'The image could not be opened.')
    }
  }

  function download() {
    if (!outputBlob) return
    const anchor = document.createElement('a')
    anchor.href = outputUrl
    anchor.download = makeOutputName(sourceName, stops)
    anchor.click()
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(
      `python scripts/make_hdr_logo.py input.png output-hdr.jpg --stops ${stops}`,
    )
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const measuredPeak = converted ? Math.round(converted.peakNits) : peakNitsForStops(stops)
  const boostCoverage = converted
    ? ((converted.boostedPixels / (source.width * source.height)) * 100).toFixed(1)
    : '—'

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="SuperWhite home">
          <span className="wordmark-mark">SW</span>
          <span>SuperWhite</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#workbench">Make one</a>
          <a href="#method">Method</a>
          <a className="github-link" href="https://github.com/Arkane-o7/SuperWhite" target="_blank" rel="noreferrer">
            <GithubIcon /> GitHub
          </a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">A tiny HDR image workshop</p>
            <h1 id="hero-title">
              White,
              <br />
              with <em>headroom.</em>
            </h1>
            <p className="hero-intro">
              Turn the brightest pixels in a logo into real HDR highlights—brighter than the
              interface around them. No upload. No account. One unusually loud JPEG.
            </p>
            <a className="text-cta" href="#workbench">
              Make your logo <ArrowIcon />
            </a>
          </div>

          <div className="hero-instrument" aria-label="Live HDR output preview">
            <div className="instrument-ruler" aria-hidden="true">
              <span>1600</span><i /><span>800</span><i /><span>400</span><i /><span>203</span>
            </div>
            <div className="emitter-frame">
              {outputUrl ? (
                <img
                  className={`hdr-image ${limited ? 'is-limited' : ''}`}
                  src={outputUrl}
                  alt="SuperWhite demo logo with HDR highlights"
                />
              ) : (
                <span className="emitter-fallback">SW</span>
              )}
              <span className="corner-label">PQ / 2020</span>
            </div>
            <div className="instrument-footer">
              <div>
                <span className={`status-dot ${hdrCapable ? 'is-live' : ''}`} />
                {hdrCapable ? 'HDR-capable display detected' : 'SDR preview mode'}
              </div>
              <button
                className="compare-button"
                type="button"
                onPointerDown={() => setLimited(true)}
                onPointerUp={() => setLimited(false)}
                onPointerCancel={() => setLimited(false)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') setLimited(true)
                }}
                onKeyUp={() => setLimited(false)}
              >
                Hold for SDR
              </button>
            </div>
          </div>
        </section>

        <section className="workbench-shell" id="workbench" aria-labelledby="workbench-title">
          <div className="section-heading">
            <p className="eyebrow">The workbench</p>
            <h2 id="workbench-title">Bring a square.<br />Leave with a beacon.</h2>
            <p>PNG or JPEG · solid background · 400 × 400 recommended</p>
          </div>

          <div className="workbench">
            <div className="preview-bay">
              <div className="preview-toolbar">
                <span>Live comparison</span>
                <span className="local-badge"><i /> Processing stays here</span>
              </div>
              <div className="preview-pair">
                <figure>
                  <img src={sourceUrl} alt="Original SDR logo" />
                  <figcaption><span>Input</span> SDR / sRGB</figcaption>
                </figure>
                <figure>
                  {outputUrl ? (
                    <img className="hdr-image" src={outputUrl} alt="Converted HDR logo" />
                  ) : (
                    <div className="preview-placeholder">Encoding</div>
                  )}
                  <figcaption><span>Output</span> Rec.2020 / PQ</figcaption>
                </figure>
              </div>

              <button
                type="button"
                className={`drop-zone ${dragging ? 'is-dragging' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  void acceptFile(event.dataTransfer.files[0])
                }}
              >
                <span className="plus">+</span>
                <span><strong>Drop your logo</strong> or choose a file</span>
                <small>Nothing is sent to a server.</small>
              </button>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(event) => void acceptFile(event.target.files?.[0])}
              />
            </div>

            <aside className="control-panel" aria-label="HDR controls">
              <div className="panel-header">
                <span>Highlight exposure</span>
                <strong>+{stops.toFixed(1)}</strong>
                <small>stops</small>
              </div>
              <input
                aria-label="Highlight exposure in stops"
                className="exposure-slider"
                type="range"
                min={MIN_STOPS}
                max={MAX_STOPS}
                step="0.1"
                value={stops}
                style={{ '--slider-progress': `${((stops - MIN_STOPS) / (MAX_STOPS - MIN_STOPS)) * 100}%` } as React.CSSProperties}
                onChange={(event) => setStops(Number(event.target.value))}
              />
              <div className="slider-labels"><span>Subtle</span><span>Solar</span></div>
              <div className="preset-row" aria-label="Exposure presets">
                {[1, 2, 2.5, 3, 3.9].map((preset) => (
                  <button
                    className={stops === preset ? 'is-active' : ''}
                    type="button"
                    key={preset}
                    aria-pressed={stops === preset}
                    onClick={() => setStops(preset)}
                  >
                    +{preset.toFixed(1)}
                  </button>
                ))}
              </div>

              <dl className="readout-grid">
                <div><dt>Target white</dt><dd>{peakNitsForStops(stops).toLocaleString()} nit</dd></div>
                <div><dt>Measured peak</dt><dd>{measuredPeak.toLocaleString()} nit</dd></div>
                <div><dt>Pixels boosted</dt><dd>{boostCoverage}%</dd></div>
                <div><dt>Container</dt><dd>Progressive JPEG</dd></div>
              </dl>

              <div className={`conversion-message is-${conversionState}`} role="status" aria-live="polite">
                <span />{message}
              </div>

              <button
                className="download-button"
                type="button"
                disabled={conversionState !== 'ready'}
                onClick={download}
              >
                <DownloadIcon /> Download HDR JPEG
              </button>
              <p className="do-not-resave"><strong>One rule:</strong> upload this exact file. Re-exporting may remove the HDR profile.</p>
            </aside>
          </div>
        </section>

        <section className="method" id="method" aria-labelledby="method-title">
          <div className="method-heading">
            <p className="eyebrow">What is in the file</p>
            <h2 id="method-title">Not a glow.<br />More light.</h2>
          </div>
          <div className="method-flow" aria-label="Conversion method">
            <article><span>01</span><h3>Decode</h3><p>The browser reads your square SDR image into local pixel data.</p></article>
            <i aria-hidden="true">→</i>
            <article><span>02</span><h3>Lift</h3><p>A soft threshold raises near-white pixels while dark tones stay composed.</p></article>
            <i aria-hidden="true">→</i>
            <article><span>03</span><h3>Encode</h3><p>Pixels move to Rec.2020, use the PQ transfer curve, and become a progressive JPEG.</p></article>
            <i aria-hidden="true">→</i>
            <article><span>04</span><h3>Tag</h3><p>The Rec.2020 PQ ICC profile is inserted without ever uploading the logo.</p></article>
          </div>
        </section>

        <section className="field-notes" aria-labelledby="notes-title">
          <div>
            <p className="eyebrow">Field notes</p>
            <h2 id="notes-title">The effect depends on the whole chain.</h2>
          </div>
          <div className="chain">
            <span>HDR file</span><b>+</b><span>profile survives</span><b>+</b><span>HDR rendering</span><b>+</b><span>HDR display</span><b>=</b><strong>SuperWhite</strong>
          </div>
          <div className="notes-grid">
            <article>
              <h3>LinkedIn is the experiment</h3>
              <p>Its current image pipeline has been observed preserving this ICC-based method. That behavior is undocumented and can change.</p>
            </article>
            <article>
              <h3>SDR fails gracefully</h3>
              <p>On a standard display, the file is tone-mapped into an ordinary-looking logo instead of breaking.</p>
            </article>
            <article>
              <h3>Use the headroom with taste</h3>
              <p>Lift a small mark, not the whole square. A beacon gets attention; a flashbang gets muted.</p>
            </article>
          </div>
        </section>

        <section className="terminal-section" aria-labelledby="terminal-title">
          <div>
            <p className="eyebrow">Prefer a terminal?</p>
            <h2 id="terminal-title">The CLI ships with the same math.</h2>
          </div>
          <button className="command" type="button" onClick={() => void copyCommand()}>
            <code><span>$</span> python scripts/make_hdr_logo.py input.png output-hdr.jpg --stops {stops}</code>
            <small>{copied ? 'Copied' : 'Copy'}</small>
          </button>
        </section>
      </main>

      <footer>
        <a className="wordmark footer-mark" href="#top"><span className="wordmark-mark">SW</span><span>SuperWhite</span></a>
        <p>Open source. Built for controlled overexposure.</p>
        <p>Core conversion method adapted with credit from <a href="https://github.com/Adamodigi/linkedin-hdr-logo" target="_blank" rel="noreferrer">Adamodigi</a>.</p>
      </footer>
    </>
  )
}

export default App
