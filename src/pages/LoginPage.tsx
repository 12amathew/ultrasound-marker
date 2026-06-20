import React, { useEffect, useState } from 'react'
import { useAppStore, type ExaminerName } from '../store/appStore'

export default function LoginPage(): React.JSX.Element {
  const { setExaminer, openSetupEdit, setScreen } = useAppStore()
  const [selected, setSelected] = useState<ExaminerName | ''>('')
  const [examiners, setExaminers] = useState<string[]>([])
  const [dbReady, setDbReady] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkDb(): Promise<void> {
      const result = await window.api.autoLoad()
      setDbReady(result.configured)
      const cfg = await window.api.getActiveProfileConfig()
      setExaminers(cfg?.examiners.map((e) => e.name) ?? [])
      setChecking(false)
    }
    checkDb()
  }, [])

  function handleBegin(): void {
    if (!selected) return
    setExaminer(selected as ExaminerName)
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-white text-lg">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Ultrasound Assessment Marking Tool</h1>
        <p className="text-slate-400">Select your name to begin</p>
      </div>

      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm flex flex-col gap-5">
        <label className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
          Examiner
        </label>
        <div className="flex flex-col gap-3">
          {examiners.map((name) => (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className={`w-full py-3 px-5 rounded-xl border-2 text-left font-medium transition-all ${
                selected === name
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        {dbReady && examiners.length === 0 && (
          <p className="text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
            No examiners are configured for the active assessment profile.
          </p>
        )}

        {!dbReady && (
          <p className="text-amber-600 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
            First time setup required. Click Edit Setup to configure your folders.
          </p>
        )}

        <div className="flex gap-3 mt-2">
          <button
            onClick={openSetupEdit}
            className="flex-1 py-2 px-4 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
          >
            Edit Setup
          </button>
          <button
            onClick={() => setScreen('admin')}
            className="flex-1 py-2 px-4 rounded-xl border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-semibold"
          >
            Admin
          </button>
          <button
            onClick={handleBegin}
            disabled={!selected || examiners.length === 0}
            className="flex-1 py-2 px-4 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Begin Marking
          </button>
        </div>
      </div>
    </div>
  )
}
