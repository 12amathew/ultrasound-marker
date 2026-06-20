import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import ImageViewer from '../components/ImageViewer'
import CandidateInstructionsPanel from '../components/CandidateInstructionsPanel'
import type { DicomStudyLink, ExaminerFormMarkDetail, FieldResponseInput, DisagreementRow, StationFormField } from '../types/ipc'

type MarkValue = number | null

export default function ResolutionPage(): React.JSX.Element {
  const { examinerName, resolutionContext, setScreen } = useAppStore()
  const ctx = resolutionContext!

  const [disagreements, setDisagreements] = useState<DisagreementRow[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [marks, setMarks] = useState<ExaminerFormMarkDetail[]>([])
  const [loading, setLoading] = useState(true)

  // Consensus inputs
  const [consensusScores, setConsensusScores] = useState<Record<string, number | null>>({})
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Images for re-examination
  const [imagesOpen, setImagesOpen] = useState(false)
  const [img1Data, setImg1Data] = useState<string | null>(null)
  const [img2Data, setImg2Data] = useState<string | null>(null)
  const [refImg1Data, setRefImg1Data] = useState<string | null>(null)
  const [dicomLinks, setDicomLinks] = useState<DicomStudyLink[]>([])

  const scoreFields = (ctx.form_fields ?? []).filter((field) => field.field_type === 'score')

  useEffect(() => {
    loadDisagreements()
  }, [])

  async function loadDisagreements(): Promise<void> {
    setLoading(true)
    const list = await window.api.getDisagreements(ctx.module_code, ctx.station_number)
    setDisagreements(list)
    if (list.length > 0) {
      setSelectedIdx(0)
      await loadStudentData(list[0])
    }
    setLoading(false)
  }

  async function loadStudentData(student: DisagreementRow): Promise<void> {
    setConsensusScores({})
    setValidationError(null)
    setImg1Data(null)
    setImg2Data(null)
    setRefImg1Data(null)
    setDicomLinks([])

    const [examinerMarks, studentImgs, refImgs, links] = await Promise.all([
      window.api.getExaminerMarks(student.student_id, ctx.module_code, ctx.station_number),
      window.api.getStudentImages(student.student_id, ctx.module_code, ctx.station_number),
      window.api.getReferenceImages(ctx.module_code, ctx.station_number),
      window.api.getDicomLinksForStation(student.student_id, ctx.module_code, ctx.station_number)
    ])
    setMarks(examinerMarks)
    setDicomLinks(links)

    // Load local image data only when no linked DICOM study exists.
    const hasDicomStudy = links.length > 0
    const [d1, d2, r1] = await Promise.all([
      !hasDicomStudy && studentImgs.img1Path ? window.api.readImageFile(studentImgs.img1Path) : Promise.resolve(null),
      !hasDicomStudy && studentImgs.img2Path ? window.api.readImageFile(studentImgs.img2Path) : Promise.resolve(null),
      refImgs.img1Path ? window.api.readImageFile(refImgs.img1Path) : Promise.resolve(null)
    ])
    setImg1Data(d1)
    setImg2Data(d2)
    setRefImg1Data(r1)
  }

  async function selectStudent(idx: number): Promise<void> {
    setSelectedIdx(idx)
    await loadStudentData(disagreements[idx])
  }

  function validate(): boolean {
    for (const field of scoreFields) {
      if (field.required && (consensusScores[field.field_id] === null || consensusScores[field.field_id] === undefined)) {
        setValidationError(`Please set consensus score for ${field.label}.`)
        return false
      }
    }
    return true
  }

  async function handleSaveConsensus(): Promise<void> {
    if (!validate()) return
    const student = disagreements[selectedIdx]
    setSaving(true)
    const responses: FieldResponseInput[] = scoreFields.map((field) => ({
      field_id: field.field_id,
      field_type: 'score',
      value_num: consensusScores[field.field_id] ?? null
    }))
    await window.api.saveDynamicConsensus(
      student.student_id,
      ctx.module_code,
      ctx.station_number,
      examinerName!,
      responses
    )
    setSaving(false)

    // Move to next disagreement
    const remaining = await window.api.getDisagreements(ctx.module_code, ctx.station_number)
    setDisagreements(remaining)

    if (remaining.length === 0) {
      setScreen('dashboard')
    } else {
      const nextIdx = Math.min(selectedIdx, remaining.length - 1)
      setSelectedIdx(nextIdx)
      await loadStudentData(remaining[nextIdx])
    }
  }

  const e1 = marks[0] ?? null
  const e2 = marks[1] ?? null

  function responseValue(mark: ExaminerFormMarkDetail | null, fieldId: string): number | null {
    const response = mark?.responses.find((r) => r.field_id === fieldId)
    return response?.value_num ?? null
  }

  function differs(field: StationFormField): boolean {
    const v1 = responseValue(e1, field.field_id)
    const v2 = responseValue(e2, field.field_id)
    if (v1 === null || v2 === null) return true
    return Math.abs(v1 - v2) > field.tolerance
  }

  function computedScore(): number | null {
    let total = 0
    for (const field of scoreFields) {
      const value = consensusScores[field.field_id]
      if (field.required && (value === null || value === undefined)) return null
      if (value !== null && value !== undefined) total += value
    }
    return total
  }

  if (loading) {
    return (
      <Shell ctx={ctx} onBack={() => setScreen('dashboard')}>
        <div className="flex-1 flex items-center justify-center text-slate-500">Loading…</div>
      </Shell>
    )
  }

  if (disagreements.length === 0) {
    return (
      <Shell ctx={ctx} onBack={() => setScreen('dashboard')}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
          <p className="text-lg font-semibold">No disagreements remaining for this station.</p>
          <button
            onClick={() => setScreen('dashboard')}
            className="px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </Shell>
    )
  }

  const currentStudent = disagreements[selectedIdx]
  const score = computedScore()
  const activeDicomLink = dicomLinks[0] ?? null

  return (
    <Shell ctx={ctx} onBack={() => setScreen('dashboard')}>
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: student list */}
        <div className="w-64 flex-shrink-0 bg-white rounded-xl border border-slate-200 overflow-y-auto">
          <p className="px-4 py-3 text-xs font-bold text-slate-500 uppercase border-b border-slate-100">
            Disagreements ({disagreements.length})
          </p>
          {disagreements.map((s, i) => (
            <button
              key={s.student_id}
              onClick={() => selectStudent(i)}
              className={`w-full text-left px-4 py-3 text-sm border-b border-slate-50 hover:bg-slate-50 ${
                i === selectedIdx ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700'
              }`}
            >
              <p className="font-medium">{s.full_name}</p>
              <p className="text-xs text-slate-400">{s.student_id}</p>
            </button>
          ))}
        </div>

        {/* Right: resolution panel */}
        <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto">
          <CandidateInstructionsPanel moduleCode={ctx.module_code} stationNumber={ctx.station_number} />
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="font-bold text-slate-800 mb-1">
              Resolve: {currentStudent.full_name}{' '}
              <span className="text-slate-400 font-normal text-sm">({currentStudent.student_id})</span>
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {ctx.module_name} › Station {ctx.station_number}
            </p>

            {/* Marks comparison table */}
            <table className="w-full text-sm mb-6 border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-3 py-2 font-semibold text-slate-600 border border-slate-200">Slot</th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600 border border-slate-200">
                    {e1?.examiner_name ?? 'Examiner 1'}
                  </th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600 border border-slate-200">
                    {e2?.examiner_name ?? 'Examiner 2'}
                  </th>
                  <th className="text-center px-3 py-2 font-semibold text-slate-600 border border-slate-200">Status</th>
                </tr>
              </thead>
              <tbody>
                {scoreFields.map((field) => (
                  <MarkRow
                    key={field.field_id}
                    label={field.label}
                    v1={responseValue(e1, field.field_id)}
                    v2={responseValue(e2, field.field_id)}
                    differs={differs(field)}
                  />
                ))}
              </tbody>
            </table>

            {/* Consensus inputs */}
            <div className="border-t border-slate-100 pt-4">
              <p className="text-sm font-bold text-slate-700 mb-3">
                Consensus — enter agreed marks (fields do not pre-fill):
              </p>
              <div className="flex gap-4 flex-wrap items-end">
                {scoreFields.map((field) => (
                  <ConsensusDropdown
                    key={field.field_id}
                    field={field}
                    value={consensusScores[field.field_id] ?? null}
                    onChange={(value) => setConsensusScores((prev) => ({ ...prev, [field.field_id]: value }))}
                  />
                ))}
                {score !== null && (
                  <div className="ml-auto text-right">
                    <p className="text-xs text-slate-500 uppercase font-semibold">Computed Score</p>
                    <p className="text-2xl font-bold text-slate-800">
                      {score.toFixed(2)} / {scoreFields.reduce((sum, field) => sum + (field.max_score ?? 0), 0)}
                    </p>
                  </div>
                )}
              </div>

              {validationError && (
                <p className="mt-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {validationError}
                </p>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleSaveConsensus}
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-40 text-sm"
                >
                  {saving ? 'Saving…' : 'Save Consensus'}
                </button>
                {selectedIdx < disagreements.length - 1 && (
                  <button
                    onClick={() => selectStudent(selectedIdx + 1)}
                    className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 text-sm"
                  >
                    Next Disagreement →
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Image re-examination panel */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => setImagesOpen(!imagesOpen)}
              className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700"
            >
              <span>Re-examine Images</span>
              <span>{imagesOpen ? '▲ Collapse' : '▼ Expand'}</span>
            </button>
            {imagesOpen && (
              activeDicomLink ? (
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500 font-semibold uppercase">Linked DICOM Study</p>
                    <span className="text-xs text-slate-400 font-mono">{activeDicomLink.patient_id}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => window.open(activeDicomLink.ohif_url, '_blank')}
                      className="px-3 py-1 rounded-lg text-xs font-semibold border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100"
                    >
                      Open OHIF
                    </button>
                  </div>
                  <div className="h-[520px] rounded-lg overflow-hidden bg-slate-900 border border-slate-800">
                    <iframe
                      src={activeDicomLink.ohif_url}
                      title={`OHIF ${activeDicomLink.patient_id}`}
                      className="w-full h-full border-0 bg-slate-900"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex gap-4 p-4">
                  <div className="flex-1 flex flex-col gap-1">
                    <p className="text-xs text-slate-500 font-semibold uppercase">Student Image 1</p>
                    <ImageViewer dataUrl={img1Data} label="Student IMG1" className="h-48 rounded-lg" />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <p className="text-xs text-slate-500 font-semibold uppercase">Student Image 2</p>
                    <ImageViewer dataUrl={img2Data} label="Student IMG2" className="h-48 rounded-lg" />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <p className="text-xs text-slate-500 font-semibold uppercase">Reference Image 1</p>
                    <ImageViewer dataUrl={refImg1Data} label="Ref IMG1" className="h-48 rounded-lg" />
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}

function MarkRow({
  label,
  v1,
  v2,
  differs
}: {
  label: string
  v1: number | null
  v2: number | null
  differs: boolean
}): React.JSX.Element {
  return (
    <tr className={differs ? 'bg-amber-50' : ''}>
      <td className="px-3 py-2 border border-slate-200 font-medium text-slate-700">{label}</td>
      <td className="px-3 py-2 border border-slate-200 text-center text-slate-700">
        {v1 ?? '—'}
      </td>
      <td className="px-3 py-2 border border-slate-200 text-center text-slate-700">
        {v2 ?? '—'}
      </td>
      <td className="px-3 py-2 border border-slate-200 text-center">
        {differs ? (
          <span className="text-amber-600 font-semibold">⚠ DIFFERS</span>
        ) : (
          <span className="text-green-600">✓ AGREE</span>
        )}
      </td>
    </tr>
  )
}

function ConsensusDropdown({
  field,
  value,
  onChange
}: {
  field: StationFormField
  value: MarkValue
  onChange: (v: MarkValue) => void
}): React.JSX.Element {
  const max = field.max_score ?? 0
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{field.label}</label>
      <select
        value={value === null ? '' : String(value)}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? null : parseInt(v))
        }}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— Select —</option>
        {Array.from({ length: max + 1 }, (_, n) => n).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </div>
  )
}

function Shell({
  ctx,
  onBack,
  children
}: {
  ctx: { module_name: string; station_number: number }
  onBack: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-sm">
          ← Dashboard
        </button>
        <span className="text-slate-300">|</span>
        <span className="font-semibold text-slate-800">
          Resolve Disagreements — {ctx.module_name} › Station {ctx.station_number}
        </span>
      </header>
      <div className="flex-1 flex flex-col p-4 min-h-0">{children}</div>
    </div>
  )
}
