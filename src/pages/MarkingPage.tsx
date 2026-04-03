import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import ImageViewer from '../components/ImageViewer'

type MarkValue = number | null

interface StudentImages {
  img1Path: string | null
  img2Path: string | null
  conclusionPath: string | null
}

interface RefImages {
  img1Path: string | null
  img2Path: string | null
}

export default function MarkingPage(): React.JSX.Element {
  const { examinerName, markingContext, studentListContext, selectedStudent, setScreen, addToSkipList, skipList } = useAppStore()

  const ctx = (studentListContext ?? markingContext)!

  function goBack(): void {
    if (studentListContext) {
      setScreen('studentList')
    } else {
      setScreen('dashboard')
    }
  }

  // Always-current refs — no stale closures
  const ctxRef = useRef(ctx)
  const examinerRef = useRef(examinerName)
  const skipListRef = useRef(skipList)
  ctxRef.current = ctx
  examinerRef.current = examinerName
  skipListRef.current = skipList

  const [student, setStudent] = useState<{ student_id: string; full_name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [noStudents, setNoStudents] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [studentImages, setStudentImages] = useState<StudentImages>({ img1Path: null, img2Path: null, conclusionPath: null })
  const [refImages, setRefImages] = useState<RefImages>({ img1Path: null, img2Path: null })
  const [studentImg1Data, setStudentImg1Data] = useState<string | null>(null)
  const [studentImg2Data, setStudentImg2Data] = useState<string | null>(null)
  const [refImg1Data, setRefImg1Data] = useState<string | null>(null)
  const [refImg2Data, setRefImg2Data] = useState<string | null>(null)
  const [conclusionData, setConclusionData] = useState<string | null>(null)
  const [imagesLoading, setImagesLoading] = useState(false)

  const [showingStudentImg, setShowingStudentImg] = useState<1 | 2>(1)
  const [showingRefImg, setShowingRefImg] = useState<1 | 2>(1)
  const [conclusionOpen, setConclusionOpen] = useState(false)

  const [img1Mark, setImg1Mark] = useState<MarkValue>(null)
  const [img2Mark, setImg2Mark] = useState<MarkValue>(null)
  const [conclusionMark, setConclusionMark] = useState<MarkValue>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Ref to the currently displayed student — used in cleanup without stale closure
  const currentStudentRef = useRef<{ student_id: string; full_name: string } | null>(null)

  function resetForm(): void {
    setStudent(null)
    setImg1Mark(null)
    setImg2Mark(null)
    setConclusionMark(null)
    setValidationError(null)
    setShowingStudentImg(1)
    setShowingRefImg(1)
    setConclusionOpen(false)
    setStudentImg1Data(null)
    setStudentImg2Data(null)
    setRefImg1Data(null)
    setRefImg2Data(null)
    setConclusionData(null)
    setStudentImages({ img1Path: null, img2Path: null, conclusionPath: null })
    setRefImages({ img1Path: null, img2Path: null })
  }

  async function loadImagesFor(s: { student_id: string; full_name: string }): Promise<void> {
    const c = ctxRef.current
    setImagesLoading(true)
    try {
      const [imgs, refs] = await Promise.all([
        window.api.getStudentImages(s.student_id, c.module_code, c.station_number),
        window.api.getReferenceImages(c.module_code, c.station_number)
      ])
      setStudentImages(imgs)
      setRefImages(refs)
      const reads = await Promise.allSettled([
        imgs.img1Path ? window.api.readImageFile(imgs.img1Path) : Promise.resolve(null),
        imgs.img2Path ? window.api.readImageFile(imgs.img2Path) : Promise.resolve(null),
        refs.img1Path ? window.api.readImageFile(refs.img1Path) : Promise.resolve(null),
        refs.img2Path ? window.api.readImageFile(refs.img2Path) : Promise.resolve(null),
        imgs.conclusionPath && c.has_conclusion
          ? window.api.readImageFile(imgs.conclusionPath)
          : Promise.resolve(null)
      ])
      const val = (r: PromiseSettledResult<string | null>): string | null =>
        r.status === 'fulfilled' ? r.value : null
      setStudentImg1Data(val(reads[0]))
      setStudentImg2Data(val(reads[1]))
      setRefImg1Data(val(reads[2]))
      setRefImg2Data(val(reads[3]))
      setConclusionData(val(reads[4]))
    } catch (err) {
      console.error('Image loading failed:', err)
    } finally {
      setImagesLoading(false)
    }
  }

  async function loadSpecificStudent(target: { student_id: string; full_name: string }): Promise<void> {
    const c = ctxRef.current
    resetForm()
    setLoadError(null)
    setLoading(true)
    try {
      await window.api.acquireLock(target.student_id, c.module_code, c.station_number, examinerRef.current!)
      currentStudentRef.current = target
      setStudent(target)
      setNoStudents(false)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
    await loadImagesFor(target)
  }

  async function loadNextInQueue(extraSkipIds: string[] = []): Promise<void> {
    const c = ctxRef.current
    resetForm()
    setLoadError(null)
    setLoading(true)
    const localSkipList = [...skipListRef.current, ...extraSkipIds]
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = await window.api.getNextStudent(
          c.module_code,
          c.station_number,
          examinerRef.current!,
          localSkipList
        )
        if (!next) {
          currentStudentRef.current = null
          setNoStudents(true)
          setLoading(false)
          return
        }
        const locked = await window.api.acquireLock(
          next.student_id, c.module_code, c.station_number, examinerRef.current!
        )
        if (!locked) {
          localSkipList.push(next.student_id)
          addToSkipList(next.student_id)
          continue
        }
        currentStudentRef.current = next
        setStudent(next)
        setNoStudents(false)
        setLoading(false)
        await loadImagesFor(next)
        return
      }
    } catch (err) {
      setLoadError(String(err))
      setLoading(false)
    }
  }

  useEffect(() => {
    // Capture selectedStudent synchronously — guaranteed fresh at first render
    const target = selectedStudent
    if (target) {
      loadSpecificStudent(target)
    } else {
      loadNextInQueue()
    }
    return () => {
      const s = currentStudentRef.current
      if (s) {
        window.api.releaseLock(s.student_id, ctxRef.current.module_code, ctxRef.current.station_number)
      }
    }
  }, []) // intentionally run once on mount

  async function releaseCurrent(): Promise<void> {
    const s = currentStudentRef.current
    if (s) {
      await window.api.releaseLock(s.student_id, ctxRef.current.module_code, ctxRef.current.station_number)
    }
  }

  function validate(): boolean {
    if (img1Mark === null || img2Mark === null) {
      setValidationError('Please set marks for both Image 1 and Image 2.')
      return false
    }
    if (ctx.has_conclusion && conclusionMark === null) {
      setValidationError('Please set the Conclusion mark.')
      return false
    }
    return true
  }

  async function handleSave(andNext: boolean): Promise<void> {
    if (!validate() || !student) return
    setSaving(true)
    await window.api.saveMark(
      student.student_id,
      ctx.module_code,
      ctx.station_number,
      examinerName!,
      img1Mark!,
      img2Mark!,
      ctx.has_conclusion ? conclusionMark : null,
      ctx.has_conclusion
    )
    await releaseCurrent()
    setSaving(false)
    if (andNext) {
      await loadNextInQueue()
    }
  }

  async function handleSkip(): Promise<void> {
    const skippedId = student!.student_id
    await releaseCurrent()
    addToSkipList(skippedId)
    await loadNextInQueue([skippedId])
  }

  const currentStudentData = showingStudentImg === 1 ? studentImg1Data : studentImg2Data
  const currentRefData = showingRefImg === 1 ? refImg1Data : refImg2Data

  if (loading) {
    return (
      <MarkingShell ctx={ctx} examinerName={examinerName!} onBack={goBack}>
        <div className="flex-1 flex items-center justify-center text-slate-500">
          Loading…
        </div>
      </MarkingShell>
    )
  }

  if (loadError) {
    return (
      <MarkingShell ctx={ctx} examinerName={examinerName!} onBack={goBack}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-red-600 font-semibold">Error loading marking page</p>
          <p className="text-sm text-slate-500 font-mono bg-slate-100 rounded-lg px-4 py-3 max-w-xl text-center">{loadError}</p>
          <button onClick={goBack} className="mt-2 px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">
            Back
          </button>
        </div>
      </MarkingShell>
    )
  }

  if (noStudents) {
    return (
      <MarkingShell ctx={ctx} examinerName={examinerName!} onBack={goBack}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
          <p className="text-lg font-semibold">All students have been marked for this station.</p>
          <p className="text-sm text-slate-400">Use the student list to review or re-mark any student.</p>
          <button onClick={goBack} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">
            Back to Student List
          </button>
        </div>
      </MarkingShell>
    )
  }

  return (
    <MarkingShell ctx={ctx} examinerName={examinerName!} student={student ?? undefined} onBack={goBack}>
      {/* Main image area */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Student image panel */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-slate-600 mr-2">Student Image</span>
            <button
              onClick={() => setShowingStudentImg(1)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${
                showingStudentImg === 1
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Image 1
            </button>
            <button
              onClick={() => setShowingStudentImg(2)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${
                showingStudentImg === 2
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Image 2
            </button>
          </div>
          <ImageViewer
            dataUrl={currentStudentData}
            label={`Student Image ${showingStudentImg}`}
            className="flex-1 rounded-xl"
            loading={imagesLoading}
          />
        </div>

        {/* Reference image panel */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-slate-600 mr-2">Reference Image</span>
            <button
              onClick={() => setShowingRefImg(1)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${
                showingRefImg === 1
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              REF 1
            </button>
            <button
              onClick={() => setShowingRefImg(2)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${
                showingRefImg === 2
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              REF 2
            </button>
          </div>
          <ImageViewer
            dataUrl={currentRefData}
            label={`REF_${ctx.module_code}_S${ctx.station_number}_IMG${showingRefImg}`}
            className="flex-1 rounded-xl"
            loading={imagesLoading}
          />
        </div>
      </div>

      {/* Conclusion panel */}
      {ctx.has_conclusion && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setConclusionOpen(!conclusionOpen)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700"
          >
            <span>Conclusion — Written Answer</span>
            <span>{conclusionOpen ? '▲ Collapse' : '▼ Expand'}</span>
          </button>
          {conclusionOpen && (
            <div className="flex gap-4 p-4 bg-white">
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Student Answer</p>
                <ImageViewer dataUrl={conclusionData} label="Student Conclusion" className="h-64 rounded-lg" />
              </div>
              <div className="flex-1 bg-blue-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-blue-600 mb-2 uppercase">Model Answer</p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {ctx.conclusion_reference_text ?? 'No model answer configured.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mark entry */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-3">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
          Scores — both required before saving
        </p>
        <div className="flex flex-wrap gap-3 items-stretch">
          <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border-2 transition-colors ${
            showingStudentImg === 1 ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-500 uppercase">Image 1</span>
              <span className={`text-xs ${img1Mark !== null ? 'text-green-600 font-semibold' : 'text-amber-500'}`}>
                {img1Mark !== null ? `Scored: ${img1Mark}` : 'Not yet scored'}
              </span>
            </div>
            <MarkDropdown value={img1Mark} onChange={setImg1Mark} />
          </div>

          <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border-2 transition-colors ${
            showingStudentImg === 2 ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50'
          }`}>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-500 uppercase">Image 2</span>
              <span className={`text-xs ${img2Mark !== null ? 'text-green-600 font-semibold' : 'text-amber-500'}`}>
                {img2Mark !== null ? `Scored: ${img2Mark}` : 'Not yet scored'}
              </span>
            </div>
            <MarkDropdown value={img2Mark} onChange={setImg2Mark} />
          </div>

          {ctx.has_conclusion && (
            <div className="flex items-center gap-3 rounded-lg px-4 py-3 border-2 border-slate-200 bg-slate-50">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-500 uppercase">Conclusion</span>
                <span className={`text-xs ${conclusionMark !== null ? 'text-green-600 font-semibold' : 'text-amber-500'}`}>
                  {conclusionMark !== null ? `Scored: ${conclusionMark}` : 'Not yet scored'}
                </span>
              </div>
              <MarkDropdown value={conclusionMark} onChange={setConclusionMark} />
            </div>
          )}

          <div className="flex gap-3 ml-auto items-center">
            {validationError && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {validationError}
              </p>
            )}
            <button
              onClick={handleSkip}
              className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 text-sm font-medium"
            >
              Skip Student
            </button>
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 text-sm font-semibold disabled:opacity-40"
            >
              Save & Stay
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-semibold disabled:opacity-40"
            >
              Save & Next
            </button>
          </div>
        </div>
      </div>
    </MarkingShell>
  )
}

function MarkingShell({
  ctx,
  examinerName,
  student,
  onBack,
  children
}: {
  ctx: { module_code: string; module_name: string; station_number: number }
  examinerName: string
  student?: { student_id: string; full_name: string }
  onBack: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-700 text-sm">
            ← Back
          </button>
          <span className="text-slate-300">|</span>
          <span className="font-semibold text-slate-800">
            {ctx.module_name} &rsaquo; Station {ctx.station_number}
          </span>
        </div>
        <div className="flex items-center gap-6 text-sm text-slate-600">
          {student && (
            <span>
              Student: <strong>{student.full_name}</strong>{' '}
              <span className="text-slate-400">({student.student_id})</span>
            </span>
          )}
          <span>Examiner: <strong>{examinerName}</strong></span>
        </div>
      </header>
      <div className="flex-1 flex flex-col gap-4 p-4 min-h-0">{children}</div>
    </div>
  )
}

function MarkDropdown({
  value,
  onChange
}: {
  value: MarkValue
  onChange: (v: MarkValue) => void
}): React.JSX.Element {
  return (
    <select
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === '' ? null : parseInt(v))
      }}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="">—</option>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </select>
  )
}
