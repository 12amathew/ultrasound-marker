import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { CsvImportResult, FileSortResult } from '../types/ipc'

type Step = 'paths' | 'csv' | 'sort' | 'done'

export default function SetupPage(): React.JSX.Element {
  const { setScreen } = useAppStore()

  const [step, setStep] = useState<Step>('paths')

  // Paths
  const [targetRoot, setTargetRoot] = useState('')
  const [refImagesRoot, setRefImagesRoot] = useState('')
  const [dbPath, setDbPath] = useState('')

  // CSV
  const [csvPath, setCsvPath] = useState('')
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)

  // File sort
  const [sourcePath, setSourcePath] = useState('')
  const [sortResult, setSortResult] = useState<FileSortResult | null>(null)
  const [sortLoading, setSortLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load persisted paths
    async function load(): Promise<void> {
      const [tr, rr, dp] = await Promise.all([
        window.api.configGet('target_root'),
        window.api.configGet('reference_images_root'),
        window.api.configGet('db_path')
      ])
      if (tr) setTargetRoot(tr)
      if (rr) setRefImagesRoot(rr)
      if (dp) setDbPath(dp)
    }
    load()
  }, [])

  async function handleSavePaths(): Promise<void> {
    if (!targetRoot || !refImagesRoot) {
      setError('Please select both folders before continuing.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const resolvedDbPath = dbPath || `${targetRoot}/marks.db`
      await window.api.initDb(resolvedDbPath)
      setDbPath(resolvedDbPath)
      await window.api.configSet('target_root', targetRoot)
      await window.api.configSet('reference_images_root', refImagesRoot)
      setStep('csv')
    } catch (e) {
      setError(String(e))
    }
    setSaving(false)
  }

  async function handleImportCsv(): Promise<void> {
    if (!csvPath) return
    setCsvLoading(true)
    setCsvResult(null)
    const result = await window.api.importCsv(csvPath)
    setCsvResult(result)
    setCsvLoading(false)
  }

  async function handleRunSort(): Promise<void> {
    if (!sourcePath) return
    setSortLoading(true)
    setSortResult(null)
    const result = await window.api.runFileSort(sourcePath, targetRoot)
    setSortResult(result)
    setSortLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Setup</h1>
          <button
            onClick={() => setScreen('login')}
            className="text-slate-500 hover:text-slate-700 text-sm"
          >
            Back to Login
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex gap-2 mb-8">
          {(['paths', 'csv', 'sort', 'done'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-2 rounded-full transition-colors ${
                s === step
                  ? 'bg-blue-600'
                  : ['paths', 'csv', 'sort', 'done'].indexOf(step) >
                    ['paths', 'csv', 'sort', 'done'].indexOf(s)
                  ? 'bg-blue-300'
                  : 'bg-slate-300'
              }`}
            />
          ))}
        </div>

        {/* ── Step 1: Paths ──────────────────────────────── */}
        {step === 'paths' && (
          <Card title="Step 1 — Configure Folders">
            <PathRow
              label="Assessment files root folder"
              hint="The folder containing student subfolders (e.g. 'Assessment file for each candidate')"
              value={targetRoot}
              onBrowse={async () => {
                const p = await window.api.selectFolder()
                if (p) setTargetRoot(p)
              }}
            />
            <PathRow
              label="Reference images folder"
              hint="Folder containing REF_[Module]_S[N]_IMG[1|2] files"
              value={refImagesRoot}
              onBrowse={async () => {
                const p = await window.api.selectFolder()
                if (p) setRefImagesRoot(p)
              }}
            />
            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
            <button
              onClick={handleSavePaths}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save & Continue'}
            </button>
          </Card>
        )}

        {/* ── Step 2: CSV Import ─────────────────────────── */}
        {step === 'csv' && (
          <Card title="Step 2 — Import Student Register">
            <p className="text-slate-600 text-sm">
              Select the <code className="bg-slate-100 px-1 rounded">student_register.csv</code> file.
              Columns expected: <code className="bg-slate-100 px-1 rounded">full_name</code>,{' '}
              <code className="bg-slate-100 px-1 rounded">student_id</code>,{' '}
              <code className="bg-slate-100 px-1 rounded">module_code_1</code>,{' '}
              <code className="bg-slate-100 px-1 rounded">module_code_2</code>
            </p>
            <PathRow
              label="Student register CSV"
              hint=""
              value={csvPath}
              onBrowse={async () => {
                const p = await window.api.selectFile([{ name: 'CSV', extensions: ['csv'] }])
                if (p) setCsvPath(p)
              }}
            />
            <button
              onClick={handleImportCsv}
              disabled={!csvPath || csvLoading}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {csvLoading ? 'Importing…' : 'Import CSV'}
            </button>

            {csvResult && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                <p className="font-semibold text-green-700 mb-1">
                  Imported {csvResult.imported} student-module records
                </p>
                {csvResult.skipped > 0 && (
                  <p className="text-amber-700">
                    {csvResult.skipped} rows skipped (out-of-scope modules or invalid IDs)
                  </p>
                )}
                {csvResult.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-red-600 cursor-pointer">
                      {csvResult.errors.length} errors
                    </summary>
                    <ul className="mt-1 space-y-1 text-red-700">
                      {csvResult.errors.map((e, i) => (
                        <li key={i}>Row {e.row}: {e.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {csvResult && (
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('sort')}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
                >
                  Continue to File Sorter
                </button>
                <button
                  onClick={() => setStep('sort')}
                  className="flex-1 py-3 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  Skip File Sorter
                </button>
              </div>
            )}
          </Card>
        )}

        {/* ── Step 3: File Sorter ────────────────────────── */}
        {step === 'sort' && (
          <Card title="Step 3 — Sort Exam Files">
            <p className="text-slate-600 text-sm">
              Select the raw exam source folder (e.g. the USB stick contents). Files will be{' '}
              <strong>copied</strong> — originals are never moved or deleted.
            </p>
            <PathRow
              label="Raw exam source folder"
              hint="e.g. '26th March - USB stick images from practicals'"
              value={sourcePath}
              onBrowse={async () => {
                const p = await window.api.selectFolder()
                if (p) setSourcePath(p)
              }}
            />
            <button
              onClick={handleRunSort}
              disabled={!sourcePath || sortLoading}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
            >
              {sortLoading ? 'Sorting files…' : 'Run File Sorter'}
            </button>

            {sortResult && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                <p className="font-semibold text-green-700">
                  {sortResult.placed} files placed from {sortResult.processed} station folders
                </p>
                {sortResult.unresolved.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-amber-700 cursor-pointer">
                      {sortResult.unresolved.length} unresolved items
                    </summary>
                    <ul className="mt-1 space-y-1 text-amber-800 max-h-48 overflow-y-auto">
                      {sortResult.unresolved.map((u, i) => (
                        <li key={i} className="truncate" title={u.source}>
                          {u.reason} — <span className="font-mono text-xs">{u.source}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {sortResult && (
              <button
                onClick={() => setStep('done')}
                className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
              >
                Continue
              </button>
            )}
          </Card>
        )}

        {/* ── Step 4: Done ───────────────────────────────── */}
        {step === 'done' && (
          <Card title="Setup Complete">
            <p className="text-slate-700">
              Everything is configured. You can now begin marking.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              <strong>Reminder:</strong> Before marking begins, open{' '}
              <code className="bg-amber-100 px-1 rounded">config/stations.json</code> and replace the
              placeholder text in <code className="bg-amber-100 px-1 rounded">conclusion_reference_text</code>{' '}
              for AS Station 8, FC Station 4, and PR Station 4.
            </div>
            <button
              onClick={() => setScreen('login')}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700"
            >
              Go to Login
            </button>
          </Card>
        )}
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="bg-white rounded-2xl shadow p-6 flex flex-col gap-5">
      <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      {children}
    </div>
  )
}

function PathRow({
  label,
  hint,
  value,
  onBrowse
}: {
  label: string
  hint: string
  value: string
  onBrowse: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-semibold text-slate-600">{label}</label>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          placeholder="Not selected"
          className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 truncate"
        />
        <button
          onClick={onBrowse}
          className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700"
        >
          Browse
        </button>
      </div>
    </div>
  )
}
