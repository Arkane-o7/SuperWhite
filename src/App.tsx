import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_STOPS,
  MAX_STOPS,
  MIN_STOPS,
  convertToHdr,
  encodeHdrJpeg,
  makeOutputName,
  peakNitsForStops,
  type ConvertedPixels,
  type PixelBuffer,
} from './lib/hdr'
import { fileToPixels, makeDemoPixels, pixelsToSdrUrl } from './lib/image'

type ConversionState = 'idle' | 'working' | 'ready' | 'error'
type MediaKind = 'image' | 'video'

const GithubIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.24.7-3.92-1.37-3.92-1.37-.53-1.35-1.3-1.71-1.3-1.71-1.06-.73.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.41-1.27.74-1.56-2.59-.3-5.31-1.3-5.31-5.68 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.07 0 0 .98-.31 3.16 1.18a10.95 10.95 0 0 1 5.75 0c2.18-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.07.75.81 1.2 1.84 1.2 3.1 0 4.39-2.73 5.38-5.33 5.67.42.36.79 1.08.79 2.18v3.24c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
)

const ArrowIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
)

const DownloadIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18"><path d="M10 2v10m0 0 4-4m-4 4L6 8M3 15.5h14" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
)

function isVideo(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v|mts|m2ts|wmv)$/i.test(file.name)
}

function videoOutputName(inputName: string, stops: number) {
  const stem = inputName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '')
  return `${stem || 'video'}-superwhite-${String(stops).replace('.', '-')}stops.mp4`
}

function App() {
  const [source, setSource] = useState<PixelBuffer>(() => makeDemoPixels())
  const [mediaKind, setMediaKind] = useState<MediaKind>('image')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoSourceUrl, setVideoSourceUrl] = useState('')
  const [sourceName, setSourceName] = useState('superwhite-demo.png')
  const [sourceInfo, setSourceInfo] = useState('720 × 720 image')
  const [stops, setStops] = useState(DEFAULT_STOPS)
  const [converted, setConverted] = useState<ConvertedPixels | null>(null)
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null)
  const [outputUrl, setOutputUrl] = useState('')
  const [conversionState, setConversionState] = useState<ConversionState>('working')
  const [message, setMessage] = useState('Preparing the HDR preview…')
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [localVideoAvailable, setLocalVideoAvailable] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const imageSourceUrl = useMemo(() => pixelsToSdrUrl(source), [source])

  useEffect(() => {
    void fetch('/api/health', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((status: { video?: boolean }) => setLocalVideoAvailable(Boolean(status.video)))
      .catch(() => setLocalVideoAvailable(false))
  }, [])

  useEffect(() => {
    if (mediaKind !== 'image') return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setConversionState('working')
      setMessage('Encoding a dimension-preserving HDR JPEG locally…')
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
        setMessage('Ready. Original dimensions kept; Rec.2020 PQ profile embedded.')
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
  }, [mediaKind, source, stops])

  useEffect(() => () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl)
  }, [outputUrl])

  useEffect(() => () => {
    if (videoSourceUrl) URL.revokeObjectURL(videoSourceUrl)
  }, [videoSourceUrl])

  async function convertVideo(file = videoFile) {
    if (!file) return
    if (!localVideoAvailable) {
      setConversionState('error')
      setMessage('Video needs the local FFmpeg runner. Clone the repo and run: npm run local')
      return
    }
    setConversionState('working')
    setMessage('FFmpeg is encoding 10-bit HDR10 locally. Long videos can take a while…')
    setOutputBlob(null)
    try {
      const response = await fetch(`/api/convert/video?stops=${stops}&name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({ error: 'Video conversion failed.' })) as { error?: string }
        throw new Error(result.error || 'Video conversion failed.')
      }
      const blob = await response.blob()
      const nextUrl = URL.createObjectURL(blob)
      setOutputUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return nextUrl
      })
      setOutputBlob(blob)
      setConversionState('ready')
      setMessage('Ready. Resolution, aspect ratio, frame rate, duration, and audio timing kept.')
    } catch (error) {
      setConversionState('error')
      setMessage(error instanceof Error ? error.message : 'The video could not be converted.')
    }
  }

  async function acceptFile(file?: File) {
    if (!file) return
    setSourceName(file.name)
    setConverted(null)
    setOutputBlob(null)
    setOutputUrl((current) => {
      if (current) URL.revokeObjectURL(current)
      return ''
    })

    if (isVideo(file)) {
      const url = URL.createObjectURL(file)
      setVideoSourceUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return url
      })
      setVideoFile(file)
      setMediaKind('video')
      setSourceInfo(`${(file.size / (1024 * 1024)).toFixed(1)} MB video · geometry preserved`)
      if (localVideoAvailable) {
        window.setTimeout(() => void convertVideo(file), 0)
      } else {
        setConversionState('error')
        setMessage('Video selected. Start the local runner with npm run local, then upload it here.')
      }
      return
    }

    setMediaKind('image')
    setVideoFile(null)
    setConversionState('working')
    setMessage('Reading the image locally…')
    try {
      const pixels = await fileToPixels(file)
      setSource(pixels)
      setSourceInfo(
        pixels.originalWidth === pixels.width && pixels.originalHeight === pixels.height
          ? `${pixels.width} × ${pixels.height} image`
          : `${pixels.originalWidth} × ${pixels.originalHeight} → ${pixels.width} × ${pixels.height} image`,
      )
    } catch (error) {
      setConversionState('error')
      setMessage(error instanceof Error ? error.message : 'The media file could not be opened.')
    }
  }

  function download() {
    if (!outputBlob || !outputUrl) return
    const anchor = document.createElement('a')
    anchor.href = outputUrl
    anchor.download = mediaKind === 'video' ? videoOutputName(sourceName, stops) : makeOutputName(sourceName, stops)
    anchor.click()
  }

  async function copyCommand() {
    const command = mediaKind === 'video'
      ? `python scripts/make_hdr_video.py input.mp4 output-hdr.mp4 --stops ${stops}`
      : `python scripts/make_hdr_image.py input.png output-hdr.jpg --stops ${stops}`
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function updateStops(value: number) {
    setStops(value)
    if (mediaKind === 'video') {
      setConversionState('idle')
      setMessage('Exposure changed. Convert again to render the new HDR10 video.')
    }
  }

  const measuredPeak = converted ? Math.round(converted.peakNits) : peakNitsForStops(stops)
  const boostCoverage = converted && mediaKind === 'image'
    ? `${((converted.boostedPixels / (source.width * source.height)) * 100).toFixed(1)}%`
    : 'per frame'
  const terminalCommand = mediaKind === 'video'
    ? `python scripts/make_hdr_video.py input.mp4 output-hdr.mp4 --stops ${stops}`
    : `python scripts/make_hdr_image.py input.png output-hdr.jpg --stops ${stops}`

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="SuperWhite home"><span>SUPER</span><strong>WHITE</strong></a>
        <nav aria-label="Primary navigation">
          <a className="nav-link" href="#workbench">Converter</a>
          <a className="nav-link" href="#method">How it works</a>
          <a className="github-link" href="https://github.com/Arkane-o7/SuperWhite" target="_blank" rel="noreferrer"><GithubIcon /><span>GitHub</span></a>
          <a className="header-cta" href="#workbench">Try it now <ArrowIcon /></a>
        </nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-inner">
            <p className="hero-eyebrow">The open-source HDR converter</p>
            <h1 id="hero-title">
              <span>Make anything</span>
              <strong className="hero-sdr-text">SUPERWHITE</strong>
            </h1>
            <p className="hero-intro">Turn any image or video into real HDR media—without changing its size, shape, or timing.</p>
            <div className="hero-actions">
              <a className="hero-primary" href="#workbench">Make it SuperWhite <ArrowIcon /></a>
              <a className="hero-secondary" href="https://github.com/Arkane-o7/SuperWhite" target="_blank" rel="noreferrer"><GithubIcon /> View on GitHub</a>
            </div>
          </div>
        </section>

        <section className="workbench-shell" id="workbench" aria-labelledby="workbench-title">
          <div className="section-heading">
            <p className="eyebrow">The workbench</p>
            <h2 id="workbench-title">Any shape.<br />Still or moving.</h2>
            <p>Original geometry · original timing · no cropping</p>
          </div>
          <div className="workbench">
            <div className="preview-bay">
              <div className="preview-toolbar"><span>Live comparison</span><span className="local-badge"><i /> Stays on this machine</span></div>
              <div className="preview-pair">
                <figure>
                  {mediaKind === 'video' ? <video src={videoSourceUrl} controls playsInline /> : <img src={imageSourceUrl} alt="Original SDR input" />}
                  <figcaption><span>Input</span> SDR / source geometry</figcaption>
                </figure>
                <figure>
                  {outputUrl ? mediaKind === 'video'
                    ? <video className="hdr-image" src={outputUrl} controls playsInline />
                    : <img className="hdr-image" src={outputUrl} alt="Converted HDR output" />
                    : <div className="preview-placeholder">{conversionState === 'working' ? 'Encoding' : 'HDR output'}</div>}
                  <figcaption><span>Output</span> Rec.2020 / PQ</figcaption>
                </figure>
              </div>
              <button type="button" className={`drop-zone ${dragging ? 'is-dragging' : ''}`} onClick={() => fileInput.current?.click()}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void acceptFile(event.dataTransfer.files[0]) }}>
                <span className="plus">+</span><span><strong>Drop any image or video</strong> or choose a file</span><small>{sourceInfo}</small>
              </button>
              <input ref={fileInput} className="visually-hidden" type="file" accept="image/*,video/*,.mkv,.avi,.mts,.m2ts" onChange={(event) => void acceptFile(event.target.files?.[0])} />
            </div>

            <aside className="control-panel" aria-label="HDR controls">
              <div className="panel-header"><span>Highlight exposure</span><strong>+{stops.toFixed(1)}</strong><small>stops</small></div>
              <input aria-label="Highlight exposure in stops" className="exposure-slider" type="range" min={MIN_STOPS} max={MAX_STOPS} step="0.1" value={stops}
                style={{ '--slider-progress': `${((stops - MIN_STOPS) / (MAX_STOPS - MIN_STOPS)) * 100}%` } as React.CSSProperties}
                onChange={(event) => updateStops(Number(event.target.value))} />
              <div className="slider-labels"><span>Subtle</span><span>Solar</span></div>
              <div className="preset-row" aria-label="Exposure presets">{[1, 2, 2.5, 3, 3.9].map((preset) => (
                <button className={stops === preset ? 'is-active' : ''} type="button" key={preset} aria-pressed={stops === preset} onClick={() => updateStops(preset)}>+{preset.toFixed(1)}</button>
              ))}</div>
              <dl className="readout-grid">
                <div><dt>Target white</dt><dd>{peakNitsForStops(stops).toLocaleString()} nit</dd></div>
                <div><dt>Measured peak</dt><dd>{measuredPeak.toLocaleString()} nit</dd></div>
                <div><dt>Pixels boosted</dt><dd>{boostCoverage}</dd></div>
                <div><dt>Container</dt><dd>{mediaKind === 'video' ? 'HDR10 HEVC / MP4' : 'HDR JPEG'}</dd></div>
              </dl>
              <div className={`conversion-message is-${conversionState}`} role="status" aria-live="polite"><span />{message}</div>
              {mediaKind === 'video' && (
                <button className="convert-button" type="button" disabled={!localVideoAvailable || conversionState === 'working'} onClick={() => void convertVideo()}>
                  {conversionState === 'working' ? 'Encoding video…' : 'Convert video to HDR10'}
                </button>
              )}
              <button className="download-button" type="button" disabled={conversionState !== 'ready' || !outputBlob} onClick={download}>
                <DownloadIcon /> Download {mediaKind === 'video' ? 'HDR10 MP4' : 'HDR JPEG'}
              </button>
              <p className="do-not-resave">{mediaKind === 'video'
                ? localVideoAvailable ? 'Native FFmpeg runner connected. Your video is processed only on this Mac.' : 'For video: clone this repo, install FFmpeg, and run npm run local.'
                : 'The image converter runs entirely in this browser and keeps the original aspect ratio.'}</p>
            </aside>
          </div>
        </section>

        <section className="method" id="method" aria-labelledby="method-title">
          <div className="method-heading"><p className="eyebrow">What changes</p><h2 id="method-title">Not a glow.<br />More light.</h2></div>
          <div className="method-flow" aria-label="Conversion method">
            <article><span>01</span><h3>Keep</h3><p>Resolution, aspect ratio, frame rate, duration, and audio timing remain intact.</p></article><i aria-hidden="true">→</i>
            <article><span>02</span><h3>Lift</h3><p>A soft threshold raises highlights without resizing or cropping the frame.</p></article><i aria-hidden="true">→</i>
            <article><span>03</span><h3>Encode</h3><p>Images become HDR JPEGs; videos become 10-bit HEVC HDR10 MP4s.</p></article><i aria-hidden="true">→</i>
            <article><span>04</span><h3>Signal</h3><p>Rec.2020 primaries and the PQ transfer curve tell HDR displays to use their headroom.</p></article>
          </div>
        </section>

        <section className="field-notes" aria-labelledby="notes-title">
          <div><p className="eyebrow">Field notes</p><h2 id="notes-title">The effect depends on the whole chain.</h2></div>
          <div className="chain"><span>HDR media</span><b>+</b><span>metadata survives</span><b>+</b><span>HDR rendering</span><b>+</b><span>HDR display</span><b>=</b><strong>SuperWhite</strong></div>
          <div className="notes-grid">
            <article><h3>Video is actual HDR10</h3><p>The local runner produces Main 10 HEVC with BT.2020 primaries, SMPTE 2084 PQ, and HDR10 mastering metadata.</p></article>
            <article><h3>SDR fails gracefully</h3><p>On a standard display, compatible players tone-map the result instead of emitting HDR highlight brightness.</p></article>
            <article><h3>No geometry tricks</h3><p>A 1920 × 1080 input remains 1920 × 1080. Portrait, ultrawide, and square inputs keep their own shape.</p></article>
          </div>
        </section>

        <section className="terminal-section" aria-labelledby="terminal-title">
          <div><p className="eyebrow">Prefer a terminal?</p><h2 id="terminal-title">The CLI handles full media files.</h2></div>
          <button className="command" type="button" onClick={() => void copyCommand()}><code><span>$</span> {terminalCommand}</code><small>{copied ? 'Copied' : 'Copy'}</small></button>
        </section>
      </main>

      <footer><a className="wordmark footer-mark" href="#top"><span className="wordmark-mark">SW</span><span>SuperWhite</span></a><p>Open source. Built for controlled overexposure.</p><p>Original geometry in. HDR light out.</p></footer>
    </>
  )
}

export default App
