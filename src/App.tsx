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

const ArrowIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
)

const DownloadIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2v10m0 0 4-4m-4 4L6 8M3 16h14" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
)

function isVideo(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v|mts|m2ts|wmv)$/i.test(file.name)
}

function videoOutputName(inputName: string, stops: number) {
  const stem = inputName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '')
  return `${stem || 'video'}-superwhite-${String(stops).replace('.', '-')}stops.mp4`
}

function makeHeroPixels(): PixelBuffer {
  const width = 1800
  const height = 430
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser cannot create the HDR headline.')
  context.fillStyle = '#050505'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffffff'
  context.font = '900 290px Arial Black, Arial, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.letterSpacing = '-18px'
  context.fillText('super white.', width / 2, height / 2 - 10)
  const imageData = context.getImageData(0, 0, width, height)
  return { data: imageData.data, width, height }
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
  const [heroHdrUrl, setHeroHdrUrl] = useState('')
  const [conversionState, setConversionState] = useState<ConversionState>('working')
  const [message, setMessage] = useState('Preparing the HDR preview…')
  const [dragging, setDragging] = useState(false)
  const [limited, setLimited] = useState(false)
  const [copied, setCopied] = useState(false)
  const [localVideoAvailable, setLocalVideoAvailable] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const imageSourceUrl = useMemo(() => pixelsToSdrUrl(source), [source])
  const hdrCapable = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(dynamic-range: high)').matches,
    [],
  )

  useEffect(() => {
    let cancelled = false
    void encodeHdrJpeg(convertToHdr(makeHeroPixels(), stops)).then((blob) => {
      if (cancelled) return
      const nextUrl = URL.createObjectURL(blob)
      setHeroHdrUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return nextUrl
      })
    })
    return () => { cancelled = true }
  }, [stops])

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
        setMessage('Ready. Same dimensions, now encoded for HDR light.')
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

  useEffect(() => () => {
    if (heroHdrUrl) URL.revokeObjectURL(heroHdrUrl)
  }, [heroHdrUrl])

  async function convertVideo(file = videoFile) {
    if (!file) return
    if (!localVideoAvailable) {
      setConversionState('error')
      setMessage('Video needs the local FFmpeg runner. Run npm run local, then choose the video again.')
      return
    }
    setConversionState('working')
    setMessage('Encoding 10-bit HDR10 locally. Long videos can take a while…')
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
      setMessage('Ready. The frame, timeline, and audio timing are unchanged.')
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
      setSourceInfo(`${(file.size / (1024 * 1024)).toFixed(1)} MB video · original frame kept`)
      if (localVideoAvailable) window.setTimeout(() => void convertVideo(file), 0)
      else {
        setConversionState('error')
        setMessage('Video selected. Start this site with npm run local to enable native HDR10 encoding.')
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
      setSourceInfo(`${pixels.width} × ${pixels.height} image · exact dimensions kept`)
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
  const boosted = converted && mediaKind === 'image'
    ? `${((converted.boostedPixels / (source.width * source.height)) * 100).toFixed(1)}%`
    : 'frame by frame'
  const terminalCommand = mediaKind === 'video'
    ? `python scripts/make_hdr_video.py input.mp4 output-hdr.mp4 --stops ${stops}`
    : `python scripts/make_hdr_image.py input.png output-hdr.jpg --stops ${stops}`

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top"><span>SW</span> SuperWhite</a>
        <nav aria-label="Primary navigation"><a href="#converter">Converter</a><a href="#details">Details</a><a href="https://github.com/Arkane-o7/SuperWhite" target="_blank" rel="noreferrer">GitHub ↗</a></nav>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">
              <span>Make your images</span>
              {heroHdrUrl
                ? <img className={`hero-hdr-word ${limited ? 'is-limited' : ''}`} src={heroHdrUrl} alt="super white." />
                : <strong>super white.</strong>}
            </h1>
            <p>Give the brightest parts of any image or video real HDR headroom. No crop. No resize. No cloud upload.</p>
            <button className="hero-action" type="button" onClick={() => fileInput.current?.click()}>Choose image or video <ArrowIcon /></button>
          </div>
          <div className="hero-meter" aria-label="HDR headline details">
            <span><i className={hdrCapable ? 'is-live' : ''} />{hdrCapable ? 'HDR display detected' : 'SDR preview'}</span>
            <span>Reference white&nbsp; 203 nit</span>
            <span>Headline&nbsp; ~{peakNitsForStops(stops).toLocaleString()} nit</span>
            <button type="button" onPointerDown={() => setLimited(true)} onPointerUp={() => setLimited(false)} onPointerCancel={() => setLimited(false)}>Hold for SDR</button>
          </div>
        </section>

        <section className="converter" id="converter" aria-labelledby="converter-title">
          <div className="section-intro">
            <p className="kicker">The converter</p>
            <h2 id="converter-title">One file in.<br />The same frame, brighter.</h2>
            <p>Images become HDR JPEGs in your browser. Videos become 10-bit HDR10 MP4s through the local FFmpeg runner.</p>
          </div>

          <div className="converter-shell">
            <button type="button" className={`file-picker ${dragging ? 'is-dragging' : ''}`} onClick={() => fileInput.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void acceptFile(event.dataTransfer.files[0]) }}>
              <span className="file-picker-plus">+</span><span><strong>Drop any image or video</strong><small>{sourceInfo}</small></span><ArrowIcon />
            </button>
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/*,video/*,.mkv,.avi,.mts,.m2ts" onChange={(event) => void acceptFile(event.target.files?.[0])} />

            <div className="media-stage">
              <figure>
                <div className="media-frame">{mediaKind === 'video' ? <video src={videoSourceUrl} controls playsInline /> : <img src={imageSourceUrl} alt="Original SDR input" />}</div>
                <figcaption><span>Before</span><small>SDR · source geometry</small></figcaption>
              </figure>
              <div className="stage-arrow" aria-hidden="true">→</div>
              <figure>
                <div className="media-frame">{outputUrl
                  ? mediaKind === 'video' ? <video className="hdr-media" src={outputUrl} controls playsInline /> : <img className="hdr-media" src={outputUrl} alt="Converted HDR output" />
                  : <span className="output-empty">{conversionState === 'working' ? 'Encoding…' : 'HDR output'}</span>}</div>
                <figcaption><span>After</span><small>Rec.2020 · PQ</small></figcaption>
              </figure>
            </div>

            <div className="control-deck">
              <div className="exposure-control">
                <div className="control-title"><span>Highlight exposure</span><strong>+{stops.toFixed(1)} <small>stops</small></strong></div>
                <input aria-label="Highlight exposure in stops" type="range" min={MIN_STOPS} max={MAX_STOPS} step="0.1" value={stops}
                  style={{ '--progress': `${((stops - MIN_STOPS) / (MAX_STOPS - MIN_STOPS)) * 100}%` } as React.CSSProperties}
                  onChange={(event) => updateStops(Number(event.target.value))} />
                <div className="presets">{[1, 2, 2.5, 3, 3.9].map((preset) => <button className={stops === preset ? 'is-active' : ''} type="button" key={preset} onClick={() => updateStops(preset)}>+{preset.toFixed(1)}</button>)}</div>
              </div>

              <dl className="readouts">
                <div><dt>Target peak</dt><dd>{peakNitsForStops(stops).toLocaleString()} nit</dd></div>
                <div><dt>Measured</dt><dd>{measuredPeak.toLocaleString()} nit</dd></div>
                <div><dt>Boosted</dt><dd>{boosted}</dd></div>
                <div><dt>Output</dt><dd>{mediaKind === 'video' ? 'HDR10 MP4' : 'HDR JPEG'}</dd></div>
              </dl>

              <div className="output-actions">
                <p className={`status is-${conversionState}`}><i />{message}</p>
                {mediaKind === 'video' && <button className="secondary-action" type="button" disabled={!localVideoAvailable || conversionState === 'working'} onClick={() => void convertVideo()}>{conversionState === 'working' ? 'Encoding video…' : 'Convert video'}</button>}
                <button className="primary-action" type="button" disabled={conversionState !== 'ready' || !outputBlob} onClick={download}><DownloadIcon /> Download {mediaKind === 'video' ? 'HDR10 MP4' : 'HDR JPEG'}</button>
              </div>
            </div>
          </div>
        </section>

        <section className="details" id="details" aria-labelledby="details-title">
          <div className="section-intro compact"><p className="kicker">What stays. What changes.</p><h2 id="details-title">Only the light.</h2></div>
          <div className="detail-grid">
            <article><span>Geometry</span><h3>Same shape in and out.</h3><p>Landscape, portrait, ultrawide, square—width and height remain exactly what you supplied.</p></article>
            <article><span>Motion</span><h3>The timeline stays intact.</h3><p>Video output retains frame rate, duration, and audio timing while moving the picture into HDR10.</p></article>
            <article><span>Brightness</span><h3>White gets headroom.</h3><p>A soft luminance ramp lifts highlights into PQ without simply painting a fake glow around them.</p></article>
            <article><span>Privacy</span><h3>Your media stays here.</h3><p>Images run in-browser. The video runner listens only on localhost and sends files directly to FFmpeg.</p></article>
          </div>
        </section>

        <section className="local-note">
          <div><p className="kicker">For video</p><h2>Run the full studio locally.</h2><p>GitHub Pages cannot execute native FFmpeg. One command launches this same interface with private, standards-correct HDR10 video conversion enabled.</p></div>
          <button className="terminal-command" type="button" onClick={() => void copyCommand()}><code><span>$</span> {terminalCommand}</code><small>{copied ? 'Copied' : 'Copy command'}</small></button>
        </section>
      </main>

      <footer><a className="brand" href="#top"><span>SW</span> SuperWhite</a><p>Original geometry in. HDR light out.</p><a href="https://github.com/Arkane-o7/SuperWhite" target="_blank" rel="noreferrer">Open source on GitHub ↗</a></footer>
    </>
  )
}

export default App
