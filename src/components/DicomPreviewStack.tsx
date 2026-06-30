import React, { useEffect, useState } from 'react'
import ImageViewer from './ImageViewer'

interface Props {
  orthancStudyId: string
  label: string
  className?: string
  initialIndex?: number
  maxPreviews?: number
}

interface Preview {
  dataUrl: string | null
  image_index: number
  orthanc_frame_index?: number | null
}

export default function DicomPreviewStack({
  orthancStudyId,
  label,
  className = '',
  initialIndex = 0,
  maxPreviews = 50
}: Props): React.JSX.Element {
  const [previews, setPreviews] = useState<Preview[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPreviews(): Promise<void> {
      setLoading(true)
      setError(null)
      setPreviews([])
      setSelectedIndex(initialIndex)

      try {
        const result = await window.api.getDicomStudyPreviews(orthancStudyId, maxPreviews)
        if (cancelled) return

        const nextPreviews = result.previews ?? []
        setPreviews(nextPreviews)
        setSelectedIndex(Math.min(Math.max(initialIndex, 0), Math.max(nextPreviews.length - 1, 0)))
        setError(result.error ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPreviews()

    return () => {
      cancelled = true
    }
  }, [orthancStudyId, initialIndex, maxPreviews])

  const selectedPreview = previews[selectedIndex] ?? null
  const canStep = previews.length > 1

  function selectPrevious(): void {
    setSelectedIndex((current) => (current === 0 ? previews.length - 1 : current - 1))
  }

  function selectNext(): void {
    setSelectedIndex((current) => (current + 1) % previews.length)
  }

  return (
    <div className={`flex flex-col min-h-0 gap-2 ${className}`}>
      <div className="flex items-center gap-2 min-h-[34px]">
        <button
          type="button"
          onClick={selectPrevious}
          disabled={!canStep}
          className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous DICOM image"
        >
          &lt;
        </button>
        <div className="min-w-[7rem] text-center text-xs font-semibold text-slate-500">
          {loading
            ? 'Loading...'
            : previews.length > 0
              ? `${selectedIndex + 1} / ${previews.length}`
              : 'No previews'}
        </div>
        <button
          type="button"
          onClick={selectNext}
          disabled={!canStep}
          className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next DICOM image"
        >
          &gt;
        </button>
        {selectedPreview?.orthanc_frame_index !== null && selectedPreview?.orthanc_frame_index !== undefined && (
          <span className="text-xs text-slate-400">
            Frame {selectedPreview.orthanc_frame_index + 1}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        <ImageViewer
          dataUrl={selectedPreview?.dataUrl ?? null}
          label={previews.length > 0 ? `${label} ${selectedIndex + 1}` : label}
          className="absolute inset-0 rounded-xl"
          loading={loading}
        />
        {!loading && error && previews.length === 0 && (
          <div className="absolute inset-x-4 bottom-10 rounded-lg border border-amber-500/50 bg-amber-950/80 px-3 py-2 text-xs text-amber-100">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
