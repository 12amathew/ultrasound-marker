/**
 * ImageViewer
 * Renders JPG/TIFF/PDF files from a base64 data URL.
 * TIFF files are decoded using the utif library and painted to a <canvas>.
 */
import React, { useEffect, useRef, useState } from 'react'
import * as UTIF from 'utif'

interface Props {
  dataUrl: string | null
  label: string
  className?: string
  loading?: boolean
}

interface TiffData {
  rgba: Uint8Array
  width: number
  height: number
}

function paintTiff(canvas: HTMLCanvasElement, tiff: TiffData): void {
  canvas.width = tiff.width
  canvas.height = tiff.height
  const ctx = canvas.getContext('2d')!
  const imageData = ctx.createImageData(tiff.width, tiff.height)
  imageData.data.set(tiff.rgba)
  ctx.putImageData(imageData, 0, 0)
}

export default function ImageViewer({ dataUrl, label, className = '', loading = false }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null)
  const [zoomed, setZoomed] = useState(false)
  const [renderType, setRenderType] = useState<'img' | 'canvas' | 'pdf' | 'empty'>('empty')
  const [tiffData, setTiffData] = useState<TiffData | null>(null)
  const [tiffError, setTiffError] = useState<string | null>(null)

  // Step 1: decode the data URL → determine render type and extract TIFF pixel data
  useEffect(() => {
    setTiffData(null)
    setTiffError(null)
    setZoomed(false)

    if (!dataUrl) {
      setRenderType('empty')
      return
    }

    if (dataUrl.startsWith('data:image/tiff') || dataUrl.startsWith('data:image/tif')) {
      try {
        const base64 = dataUrl.split(',')[1]
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

        const ifds = UTIF.decode(bytes.buffer)
        if (!ifds || ifds.length === 0) throw new Error('No image data in TIFF file')
        UTIF.decodeImage(bytes.buffer, ifds[0])
        const rgba = UTIF.toRGBA8(ifds[0])
        const width = ifds[0].width as number
        const height = ifds[0].height as number

        setTiffData({ rgba, width, height })
        setRenderType('canvas')
      } catch (err) {
        setTiffError(`TIFF decode failed: ${String(err)}`)
        setRenderType('empty')
      }
    } else if (dataUrl.startsWith('data:application/pdf')) {
      setRenderType('pdf')
    } else {
      setRenderType('img')
    }
  }, [dataUrl])

  // Step 2: paint TIFF pixel data to canvas once it is in the DOM
  useEffect(() => {
    if (renderType === 'canvas' && tiffData && canvasRef.current) {
      paintTiff(canvasRef.current, tiffData)
    }
  }, [renderType, tiffData])

  // Paint the zoom canvas whenever it becomes visible
  useEffect(() => {
    if (zoomed && tiffData && zoomCanvasRef.current) {
      paintTiff(zoomCanvasRef.current, tiffData)
    }
  }, [zoomed, tiffData])

  const content = (
    <div className={`relative bg-slate-900 flex items-center justify-center ${className}`}>
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 bg-slate-900 z-10">
          <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm">Loading image…</p>
        </div>
      )}

      {!loading && renderType === 'empty' && (
        <div className="flex flex-col items-center gap-2 text-slate-500">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p className="text-sm">No image</p>
          {tiffError && (
            <p className="text-xs text-red-400 max-w-xs text-center px-2">{tiffError}</p>
          )}
        </div>
      )}

      {renderType === 'canvas' && (
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain cursor-zoom-in"
          onClick={() => setZoomed(true)}
          style={{ display: 'block' }}
        />
      )}

      {renderType === 'img' && dataUrl && (
        <img
          src={dataUrl}
          alt={label}
          className="max-w-full max-h-full object-contain cursor-zoom-in"
          onClick={() => setZoomed(true)}
        />
      )}

      {renderType === 'pdf' && dataUrl && (
        <iframe
          src={dataUrl}
          title={label}
          className="w-full h-full border-0"
        />
      )}

      <span className="absolute bottom-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
        {label}
      </span>
    </div>
  )

  return (
    <>
      {content}
      {/* Zoom modal — uses a separate canvas ref so it gets its own paint call */}
      {zoomed && renderType !== 'empty' && renderType !== 'pdf' && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setZoomed(false)}
        >
          {renderType === 'canvas' && (
            <canvas
              ref={zoomCanvasRef}
              className="max-w-full max-h-full object-contain"
              style={{ display: 'block' }}
            />
          )}
          {renderType === 'img' && dataUrl && (
            <img src={dataUrl} alt={label} className="max-w-full max-h-full object-contain" />
          )}
          <p className="absolute top-4 right-6 text-white text-sm">Click anywhere to close</p>
        </div>
      )}
    </>
  )
}
