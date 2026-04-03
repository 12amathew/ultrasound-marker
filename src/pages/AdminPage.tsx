import React, { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type { AuditEntry, FileSortResult, ImportResult } from '../types/ipc'
import stationsConfig from '../../config/stations.json'

type AdminTab = 'sort' | 'audit' | 'sync' | 'reset'

// ── Status helpers ────────────────────────────────────────────────────────────

function entryStatus(e: AuditEntry): 'ok' | 'partial' | 'missing' {
  const hasRequired = e.img1 && e.img2 && (!e.requires_conclusion || e.conclusion)
  if (hasRequired) return 'ok'
  if (e.img1 || e.img2) return 'partial'
  return 'missing'
}

function StatusBadge({ status }: { status: 'ok' | 'partial' | 'missing' }): React.JSX.Element {
  const styles = {
    ok: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    missing: 'bg-red-100 text-red-700'
  }
  const labels = { ok: 'OK', partial: 'Partial', missing: 'Missing' }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

function SlotIndicator({
  value,
  label,
  onLink
}: {
  value: string | null
  label: string
  onLink: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${value ? 'bg-green-500' : 'bg-red-400'}`}
      />
      <span className="text-xs text-slate-600 truncate max-w-[120px]" title={value ?? undefined}>
        {value ?? (
          <button
            onClick={onLink}
            className="text-blue-600 hover:underline text-xs"
          >
            Link {label}
          </button>
        )}
      </span>
    </div>
  )
}

// ── Sort panel ────────────────────────────────────────────────────────────────

function SortResultBox({ result }: { result: FileSortResult }): React.JSX.Element {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm flex flex-col gap-2">
      <p className="font-semibold text-green-700">
        {result.placed} files placed ({result.processed} entries checked)
      </p>
      {result.unresolved.length > 0 && (
        <details>
          <summary className="text-amber-700 cursor-pointer font-medium">
            {result.unresolved.length} items could not be resolved
          </summary>
          <ul className="mt-2 space-y-1 text-amber-800 max-h-56 overflow-y-auto">
            {result.unresolved.map((u, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium">{u.reason}</span>
                <br />
                <span className="font-mono text-slate-500 break-all">{u.source}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.unresolved.length > 0 && (
        <p className="text-xs text-slate-500">
          Switch to the <strong>Image Audit</strong> tab to manually link any remaining missing files.
        </p>
      )}
    </div>
  )
}

function SortPanel(): React.JSX.Element {
  const [sourcePath, setSourcePath] = useState('')
  const [targetRoot, setTargetRoot] = useState('')
  const [result, setResult] = useState<FileSortResult | null>(null)
  const [loading, setLoading] = useState(false)

  const [assessmentRoot, setAssessmentRoot] = useState('')
  const [conclusionResult, setConclusionResult] = useState<FileSortResult | null>(null)
  const [conclusionLoading, setConclusionLoading] = useState(false)

  React.useEffect(() => {
    window.api.configGet('target_root').then((v) => { if (v) setTargetRoot(v) })
  }, [])

  async function browse(): Promise<void> {
    const p = await window.api.selectFolder()
    if (p) setSourcePath(p)
  }

  async function run(): Promise<void> {
    if (!sourcePath || !targetRoot) return
    setLoading(true)
    setResult(null)
    const r = await window.api.runFileSort(sourcePath, targetRoot)
    setResult(r)
    setLoading(false)
  }

  async function browseAssessment(): Promise<void> {
    const p = await window.api.selectFolder()
    if (p) setAssessmentRoot(p)
  }

  async function runFindConclusions(): Promise<void> {
    if (!assessmentRoot || !targetRoot) return
    setConclusionLoading(true)
    setConclusionResult(null)
    const r = await window.api.findConclusions(assessmentRoot, targetRoot)
    setConclusionResult(r)
    setConclusionLoading(false)
  }

  return (
    <div className="flex flex-col gap-8">

      {/* ── Section 1: Image file sorter ── */}
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-bold text-slate-700 mb-1">Sort exam images</h3>
          <p className="text-sm text-slate-600">
            Select the raw exam source folder (e.g. the USB stick contents). The app will recursively
            scan for any folder whose name contains a student/station code (like{' '}
            <code className="bg-slate-100 px-1 rounded">P1S1HD178039</code> or{' '}
            <code className="bg-slate-100 px-1 rounded">P6_S8_AS_193063</code>) and copy the images
            inside it to the correct student folder. Originals are never moved or deleted.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-slate-600">Raw exam source folder</label>
          <p className="text-xs text-slate-400">e.g. "26th March - USB stick images from practicals"</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={sourcePath}
              placeholder="Not selected"
              className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 truncate"
            />
            <button
              onClick={browse}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700"
            >
              Browse
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-slate-600">Destination (assessment files root)</label>
          <input
            readOnly
            value={targetRoot || 'Not configured — run Setup first'}
            className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-500 truncate"
          />
        </div>

        <button
          onClick={run}
          disabled={!sourcePath || !targetRoot || loading}
          className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? 'Sorting files…' : 'Run File Sorter'}
        </button>

        {result && <SortResultBox result={result} />}
      </div>

      <hr className="border-slate-200" />

      {/* ── Section 2: Conclusion form finder ── */}
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-bold text-slate-700 mb-1">Find conclusion forms</h3>
          <p className="text-sm text-slate-600">
            Select the <strong>Assessment File for Each Candidate</strong> root folder. The app will
            look for conclusion forms (e.g. <code className="bg-slate-100 px-1 rounded">100114827 Form E4.pdf</code>)
            inside each student's sub-folder and copy any that are missing into the correct station
            folder. Covers FC Station 4, AS Stations 4 &amp; 8, and PR Station 4.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold text-slate-600">Assessment File for Each Candidate folder</label>
          <p className="text-xs text-slate-400">The folder that contains individual student ID sub-folders</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={assessmentRoot}
              placeholder="Not selected"
              className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 truncate"
            />
            <button
              onClick={browseAssessment}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700"
            >
              Browse
            </button>
          </div>
        </div>

        <button
          onClick={runFindConclusions}
          disabled={!assessmentRoot || !targetRoot || conclusionLoading}
          className="w-full py-3 rounded-xl bg-teal-600 text-white font-semibold hover:bg-teal-700 disabled:opacity-40"
        >
          {conclusionLoading ? 'Searching…' : 'Find & Copy Conclusion Forms'}
        </button>

        {conclusionResult && <SortResultBox result={conclusionResult} />}
      </div>

    </div>
  )
}

// ── Audit panel ───────────────────────────────────────────────────────────────

function AuditPanel(): React.JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [moduleFilter, setModuleFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'partial' | 'missing'>('all')
  const [linking, setLinking] = useState<{ entry: AuditEntry; slot: 'img1' | 'img2' | 'conclusion' } | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await window.api.auditImages()
    setEntries(data)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const moduleCodes = stationsConfig.modules.map((m) => m.code)

  const filtered = entries.filter((e) => {
    if (moduleFilter !== 'ALL' && e.module_code !== moduleFilter) return false
    const s = entryStatus(e)
    if (statusFilter !== 'all' && s !== statusFilter) return false
    return true
  })

  const summary = {
    ok: entries.filter((e) => entryStatus(e) === 'ok').length,
    partial: entries.filter((e) => entryStatus(e) === 'partial').length,
    missing: entries.filter((e) => entryStatus(e) === 'missing').length
  }

  async function handleLink(entry: AuditEntry, slot: 'img1' | 'img2' | 'conclusion'): Promise<void> {
    setLinkError(null)
    const exts = slot === 'conclusion'
      ? [{ name: 'Images & PDF', extensions: ['jpg', 'jpeg', 'tif', 'tiff', 'pdf'] }]
      : [{ name: 'Images', extensions: ['jpg', 'jpeg', 'tif', 'tiff'] }]

    const filePath = await window.api.selectFile(exts)
    if (!filePath) return

    setLinking({ entry, slot })
    const result = await window.api.copyFileToStation(
      filePath,
      entry.student_id,
      entry.module_code,
      entry.station_number,
      slot
    )

    if (!result.success) {
      setLinkError(`Failed to link file: ${result.reason}`)
    }
    setLinking(null)
    // Refresh audit to reflect change
    await load()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="flex gap-3">
        <SummaryChip label="Complete" count={summary.ok} colour="green" />
        <SummaryChip label="Partial" count={summary.partial} colour="amber" />
        <SummaryChip label="Missing" count={summary.missing} colour="red" />
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700 disabled:opacity-40"
        >
          {loading ? 'Scanning…' : 'Re-scan'}
        </button>
      </div>

      {linkError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {linkError}
        </p>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <FilterChip label="All modules" active={moduleFilter === 'ALL'} onClick={() => setModuleFilter('ALL')} />
        {moduleCodes.map((code) => (
          <FilterChip key={code} label={code} active={moduleFilter === code} onClick={() => setModuleFilter(code)} />
        ))}
        <span className="w-px bg-slate-300 mx-1" />
        <FilterChip label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <FilterChip label="OK" active={statusFilter === 'ok'} onClick={() => setStatusFilter('ok')} colour="green" />
        <FilterChip label="Partial" active={statusFilter === 'partial'} onClick={() => setStatusFilter('partial')} colour="amber" />
        <FilterChip label="Missing" active={statusFilter === 'missing'} onClick={() => setStatusFilter('missing')} colour="red" />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center text-slate-400 py-12">Scanning image directories…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-400 py-12">No entries match the current filter.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Student</th>
                <th className="px-4 py-3 text-left font-semibold">Module</th>
                <th className="px-4 py-3 text-left font-semibold">Station</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">IMG 1</th>
                <th className="px-4 py-3 text-left font-semibold">IMG 2</th>
                <th className="px-4 py-3 text-left font-semibold">Conclusion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((e, i) => {
                const st = entryStatus(e)
                const rowBg = st === 'ok' ? '' : st === 'partial' ? 'bg-amber-50' : 'bg-red-50'
                const isLinking = linking?.entry === e
                return (
                  <tr key={i} className={`${rowBg} hover:bg-slate-50 transition-colors`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{e.full_name}</p>
                      <p className="text-xs text-slate-400 font-mono">{e.student_id}</p>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-700">{e.module_code}</td>
                    <td className="px-4 py-2.5 text-slate-600">Stn {e.station_number}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={st} />
                    </td>
                    <td className="px-4 py-2.5">
                      <SlotIndicator
                        value={e.img1}
                        label="IMG1"
                        onLink={() => !isLinking && handleLink(e, 'img1')}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <SlotIndicator
                        value={e.img2}
                        label="IMG2"
                        onLink={() => !isLinking && handleLink(e, 'img2')}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {e.requires_conclusion ? (
                        <SlotIndicator
                          value={e.conclusion}
                          label="Conclusion"
                          onLink={() => !isLinking && handleLink(e, 'conclusion')}
                        />
                      ) : (
                        <span className="text-xs text-slate-300">N/A</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Showing {filtered.length} of {entries.length} station slots.
        Click "Link IMG1/IMG2" on any missing slot to manually assign a file.
        The file will be copied into the correct student/station folder.
      </p>
    </div>
  )
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function SummaryChip({
  label,
  count,
  colour
}: {
  label: string
  count: number
  colour: 'green' | 'amber' | 'red'
}): React.JSX.Element {
  const styles = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700'
  }
  return (
    <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${styles[colour]}`}>
      {count} {label}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
  colour
}: {
  label: string
  active: boolean
  onClick: () => void
  colour?: 'green' | 'amber' | 'red'
}): React.JSX.Element {
  const activeStyles =
    colour === 'green'
      ? 'bg-green-600 text-white'
      : colour === 'amber'
      ? 'bg-amber-500 text-white'
      : colour === 'red'
      ? 'bg-red-500 text-white'
      : 'bg-blue-600 text-white'

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
        active ? activeStyles : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

// ── Reset panel ───────────────────────────────────────────────────────────────

function ResetPanel(): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReset(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.api.resetMarks()
      setDone(true)
      setConfirmed(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        <p className="font-semibold mb-1">Danger zone — testing only</p>
        <p>
          This permanently deletes <strong>all examiner marks, resolved marks, marking states, and
          locks</strong> from the database. Student names and image files are not affected.
          Use this to reset during testing.
        </p>
      </div>

      {done && (
        <p className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm font-semibold">
          All marks have been cleared. The dashboard will now show 0 progress.
        </p>
      )}

      {error && (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm font-semibold">
          Reset failed: {error}
        </p>
      )}

      {!confirmed ? (
        <button
          onClick={() => { setConfirmed(true); setDone(false) }}
          className="w-full py-3 rounded-xl bg-red-100 text-red-700 font-semibold hover:bg-red-200 border border-red-300"
        >
          Reset all marks…
        </button>
      ) : (
        <div className="flex flex-col gap-3 border border-red-300 rounded-xl p-4 bg-red-50">
          <p className="text-sm font-semibold text-red-700">
            Are you sure? This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmed(false)}
              className="flex-1 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleReset}
              disabled={busy}
              className="flex-1 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40 text-sm"
            >
              {busy ? 'Clearing…' : 'Yes, delete all marks'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sync panel ────────────────────────────────────────────────────────────────

function SyncPanel(): React.JSX.Element {
  const [exporting, setExporting] = useState(false)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  async function handleExport(): Promise<void> {
    setExporting(true)
    setExportPath(null)
    setExportError(null)
    const result = await window.api.exportMarks()
    if (result?.success) {
      setExportPath(result.path ?? null)
    } else {
      setExportError(result?.error ?? 'Export cancelled.')
    }
    setExporting(false)
  }

  async function handleImport(): Promise<void> {
    setImporting(true)
    setImportResult(null)
    const result = await window.api.importMarks()
    if (result) setImportResult(result)
    setImporting(false)
  }

  return (
    <div className="flex flex-col gap-8">
      {/* How it works */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex flex-col gap-2">
        <p className="font-semibold">How multi-examiner marking works</p>
        <ol className="list-decimal list-inside space-y-1 text-blue-700">
          <li>Both examiners mark all students independently on their own laptops.</li>
          <li>Examiner 2 uses <strong>Export my marks</strong> to save a small JSON file.</li>
          <li>That file is sent to Examiner 1 (email, USB, AirDrop — anything).</li>
          <li>Examiner 1 uses <strong>Import examiner marks</strong> to merge the file.</li>
          <li>Agreement detection runs automatically. Disagreements appear in the dashboard for resolution.</li>
        </ol>
      </div>

      {/* Export */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-slate-700">Export my marks</h3>
        <p className="text-sm text-slate-500">
          Saves all marks from this database to a <code className="bg-slate-100 px-1 rounded">.json</code> file.
          Send this file to the other examiner so they can import it.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
        >
          {exporting ? 'Exporting…' : 'Export my marks'}
        </button>
        {exportPath && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
            Saved to: <span className="font-mono break-all">{exportPath}</span>
          </div>
        )}
        {exportError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {exportError}
          </p>
        )}
      </div>

      <hr className="border-slate-200" />

      {/* Import */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-slate-700">Import examiner marks</h3>
        <p className="text-sm text-slate-500">
          Pick the <code className="bg-slate-100 px-1 rounded">.json</code> file exported by the other
          examiner. Their marks will be merged into this database and agreement detection will run
          automatically. Existing marks are never overwritten.
        </p>
        <button
          onClick={handleImport}
          disabled={importing}
          className="w-full py-3 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-40"
        >
          {importing ? 'Importing…' : 'Import examiner marks'}
        </button>

        {importResult && (
          <div className={`rounded-lg p-4 text-sm flex flex-col gap-2 ${
            importResult.error
              ? 'bg-red-50 border border-red-200'
              : 'bg-green-50 border border-green-200'
          }`}>
            {importResult.error ? (
              <p className="text-red-700 font-semibold">{importResult.error}</p>
            ) : (
              <>
                <p className="font-semibold text-green-700">
                  Import complete — {importResult.imported} marks added
                </p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-slate-600 mt-1">
                  <span>Marks imported:</span>
                  <span className="font-semibold">{importResult.imported}</span>
                  <span>Already present (skipped):</span>
                  <span className="font-semibold">{importResult.skipped}</span>
                  <span>Auto-agreed stations:</span>
                  <span className="font-semibold text-green-600">{importResult.agreements}</span>
                  <span>Disagreements to resolve:</span>
                  <span className={`font-semibold ${importResult.disagreements > 0 ? 'text-amber-600' : ''}`}>
                    {importResult.disagreements}
                  </span>
                </div>
                {importResult.disagreements > 0 && (
                  <p className="text-amber-700 text-xs mt-1">
                    Go to the Dashboard to see which stations need resolution.
                  </p>
                )}
              </>
            )}
            {importResult.warning && (
              <p className="text-amber-700 text-xs border-t border-amber-200 pt-2 mt-1">
                {importResult.warning}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main AdminPage ────────────────────────────────────────────────────────────

export default function AdminPage(): React.JSX.Element {
  const { setScreen } = useAppStore()
  const [tab, setTab] = useState<AdminTab>('sort')

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Admin — File Management</h1>
        <button
          onClick={() => setScreen('dashboard')}
          className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300"
        >
          Back to Dashboard
        </button>
      </header>

      <main className="p-6 max-w-5xl mx-auto flex flex-col gap-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl shadow p-1 w-fit">
          <TabButton label="Sort Files" active={tab === 'sort'} onClick={() => setTab('sort')} />
          <TabButton label="Image Audit" active={tab === 'audit'} onClick={() => setTab('audit')} />
          <TabButton label="Sync Marks" active={tab === 'sync'} onClick={() => setTab('sync')} />
          <TabButton label="Reset Marks" active={tab === 'reset'} onClick={() => setTab('reset')} colour="red" />
        </div>

        {/* Panel */}
        <div className="bg-white rounded-2xl shadow p-6">
          {tab === 'sort' && <SortPanel />}
          {tab === 'audit' && <AuditPanel />}
          {tab === 'sync' && <SyncPanel />}
          {tab === 'reset' && <ResetPanel />}
        </div>
      </main>
    </div>
  )
}

function TabButton({
  label,
  active,
  onClick,
  colour = 'blue'
}: {
  label: string
  active: boolean
  onClick: () => void
  colour?: 'blue' | 'red'
}): React.JSX.Element {
  const activeStyle = colour === 'red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active ? activeStyle : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )
}
