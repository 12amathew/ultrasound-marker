import React, { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import type {
  AuditEntry,
  DicomSyncResult,
  DicomUnresolvedStudy,
  DicomUploadResult,
  FileSortResult,
  ImportResult,
  ProfileConfig,
  StationFormField
} from '../types/ipc'

type AdminTab = 'profile' | 'sort' | 'dicom' | 'audit' | 'sync' | 'reset'

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
  const [moduleCodes, setModuleCodes] = useState<string[]>([])
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
    window.api.getActiveProfileConfig().then((cfg) => setModuleCodes(cfg?.modules.map((m) => m.code) ?? []))
  }, [load])

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

// ── Profile editor panel ─────────────────────────────────────────────────────

function ProfilePanel(): React.JSX.Element {
  const [cfg, setCfg] = useState<ProfileConfig | null>(null)
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; is_active: number }>>([])
  const [selectedModule, setSelectedModule] = useState('')
  const [selectedStation, setSelectedStation] = useState<number | null>(null)
  const [studentPaste, setStudentPaste] = useState('')
  const [pin, setPin] = useState('')
  const [newProfileName, setNewProfileName] = useState('')
  const [showNewProfile, setShowNewProfile] = useState(false)
  const [showNewModule, setShowNewModule] = useState(false)
  const [newModuleCode, setNewModuleCode] = useState('')
  const [newModuleName, setNewModuleName] = useState('')
  const [showNewStation, setShowNewStation] = useState(false)
  const [newStationNumber, setNewStationNumber] = useState('')
  const [newFieldType, setNewFieldType] = useState<'score' | 'text' | null>(null)
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [next, profileRows] = await Promise.all([
      window.api.getActiveProfileConfig(),
      window.api.listProfiles()
    ])
    setCfg(next)
    setProfiles(profileRows)
    const firstModule = next?.modules[0]?.code ?? ''
    setSelectedModule(firstModule)
    setSelectedStation(next?.modules[0]?.stations[0]?.station_number ?? null)
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const mod = cfg?.modules.find((m) => m.code === selectedModule) ?? null
  const station = mod?.stations.find((s) => s.station_number === selectedStation) ?? null

  function update(next: ProfileConfig): void {
    setCfg({ ...next })
  }

  async function save(): Promise<void> {
    if (!cfg) return
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const saved = await window.api.saveProfileConfig(cfg)
      setCfg(saved)
      setStatus('Profile saved.')
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  async function savePin(): Promise<void> {
    if (!cfg || !pin.trim()) return
    setError(null)
    await window.api.setAdminPin(cfg.profile.id, pin.trim())
    setPin('')
    await load()
    setStatus('Admin PIN updated.')
  }

  async function exportPackage(): Promise<void> {
    setStatus(null)
    const result = await window.api.exportProfilePackage()
    setStatus(result?.success ? `Package exported: ${result.path}` : 'Export cancelled.')
  }

  async function importPackage(forceReplace = false): Promise<void> {
    setStatus(null)
    setError(null)
    try {
      const result = await window.api.importProfilePackage(forceReplace)
      if (result?.warning) {
        setError(result.warning)
      } else if (result?.success) {
        setStatus('Profile package imported.')
        await load()
      }
    } catch (err) {
      setError(String(err))
    }
  }

  async function createProfile(): Promise<void> {
    const name = newProfileName.trim()
    if (!name) {
      setError('Enter a profile name first.')
      return
    }
    setError(null)
    setStatus(null)
    try {
      const profile = await window.api.createProfile(name)
      await window.api.setActiveProfile(profile.id)
      setNewProfileName('')
      setShowNewProfile(false)
      await load()
      setStatus(`Created profile "${name}". Add modules, stations, students, and examiners before marking.`)
    } catch (err) {
      setError(String(err))
    }
  }

  async function selectProfile(profileId: string): Promise<void> {
    await window.api.setActiveProfile(profileId)
    await load()
    setStatus('Active profile changed.')
  }

  function addModule(): void {
    if (!cfg) return
    const code = newModuleCode.trim().toUpperCase()
    const name = newModuleName.trim() || code
    if (!/^[A-Z]{2}$/.test(code)) {
      setError('Module code must be exactly 2 uppercase letters.')
      return
    }
    if (cfg.modules.some((m) => m.code === code)) {
      setError(`Module ${code} already exists.`)
      return
    }
    setError(null)
    const next = {
      ...cfg,
      modules: [
        ...cfg.modules,
        { code, name, aliases: [code], stations: [] }
      ]
    }
    update(next)
    setSelectedModule(code)
    setSelectedStation(null)
    setNewModuleCode('')
    setNewModuleName('')
    setShowNewModule(false)
    setStatus(`Module ${code} staged. Click Save Profile to persist it.`)
  }

  function deleteModule(code: string): void {
    if (!cfg) return
    if (!window.confirm('Delete this module and related local profile settings? Export a backup first if marks need preserving.')) return
    const modules = cfg.modules.filter((m) => m.code !== code)
    update({ ...cfg, modules })
    setSelectedModule(modules[0]?.code ?? '')
    setSelectedStation(modules[0]?.stations[0]?.station_number ?? null)
  }

  function addStation(): void {
    if (!cfg || !mod) return
    const n = Number(newStationNumber)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Station number must be a positive whole number.')
      return
    }
    if (mod.stations.some((s) => s.station_number === n)) {
      setError(`Station ${n} already exists for ${mod.code}.`)
      return
    }
    setError(null)
    const next = {
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.code === mod.code
          ? {
              ...m,
              stations: [
                ...m.stations,
                {
                  module_code: m.code,
                  station_number: n,
                  label: `Station ${n}`,
                  candidate_instructions: '',
                  form_fields: [
                    { field_id: 'IMG1', label: 'Image 1', field_type: 'score' as const, max_score: 10, tolerance: 1, required: true, sort_order: 0 },
                    { field_id: 'IMG2', label: 'Image 2', field_type: 'score' as const, max_score: 10, tolerance: 1, required: true, sort_order: 1 }
                  ]
                }
              ]
            }
          : m
      )
    }
    update(next)
    setSelectedStation(n)
    setNewStationNumber('')
    setShowNewStation(false)
    setStatus(`Station ${n} staged. Click Save Profile to persist it.`)
  }

  function updateStationField<K extends 'label' | 'candidate_instructions'>(key: K, value: string): void {
    if (!cfg || !mod || !station) return
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.code === mod.code
          ? {
              ...m,
              stations: m.stations.map((s) =>
                s.station_number === station.station_number ? { ...s, [key]: value } : s
              )
            }
          : m
      )
    })
  }

  function addField(type: 'score' | 'text'): void {
    if (!cfg || !mod || !station) return
    const label = newFieldLabel.trim()
    if (!label) return
    const fieldId = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    if (station.form_fields.some((field) => field.field_id === fieldId)) {
      setError(`A field with ID ${fieldId} already exists on this station.`)
      return
    }
    setError(null)
    const newField: StationFormField = {
      field_id: fieldId,
      label,
      field_type: type,
      max_score: type === 'score' ? 10 : null,
      tolerance: 1,
      required: type === 'score',
      sort_order: station.form_fields.length
    }
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.code === mod.code
          ? {
              ...m,
              stations: m.stations.map((s) =>
                s.station_number === station.station_number
                  ? { ...s, form_fields: [...s.form_fields, newField] }
                  : s
              )
            }
          : m
      )
    })
    setNewFieldType(null)
    setNewFieldLabel('')
    setStatus(`${type === 'score' ? 'Score' : 'Text'} field staged. Click Save Profile to persist it.`)
  }

  function updateField(fieldId: string, patch: Partial<StationFormField>): void {
    if (!cfg || !mod || !station) return
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.code === mod.code
          ? {
              ...m,
              stations: m.stations.map((s) =>
                s.station_number === station.station_number
                  ? {
                      ...s,
                      form_fields: s.form_fields.map((f) => (f.field_id === fieldId ? { ...f, ...patch } : f))
                    }
                  : s
              )
            }
          : m
      )
    })
  }

  function deleteField(fieldId: string): void {
    if (!cfg || !mod || !station) return
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.code === mod.code
          ? {
              ...m,
              stations: m.stations.map((s) =>
                s.station_number === station.station_number
                  ? { ...s, form_fields: s.form_fields.filter((f) => f.field_id !== fieldId) }
                  : s
              )
            }
          : m
      )
    })
  }

  function pasteStudents(): void {
    if (!cfg || !studentPaste.trim()) return
    const rows = studentPaste
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\t|,/).map((p) => p.trim())
        return {
          student_id: (parts[0] ?? '').replace(/\D/g, ''),
          full_name: parts[1] ?? '',
          module_codes: (parts[2] ?? '').split(/[;\s]+/).map((m) => m.trim().toUpperCase()).filter(Boolean)
        }
      })
      .filter((row) => row.student_id && row.full_name)
    const byId = new Map(cfg.students.map((student) => [student.student_id, student]))
    for (const row of rows) byId.set(row.student_id, row)
    update({ ...cfg, students: [...byId.values()] })
    setStudentPaste('')
    setStatus(`${rows.length} pasted student rows staged. Save profile to apply.`)
  }

  if (!cfg) {
    return <div className="text-center text-slate-400 py-12">Loading profile...</div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-600">Active profile</span>
          <div className="flex gap-2">
            <select
              value={cfg.profile.id}
              onChange={(event) => selectProfile(event.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <button
              onClick={() => {
                setShowNewProfile((value) => !value)
                setError(null)
              }}
              className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-semibold border border-blue-200"
            >
              New
            </button>
          </div>
          {showNewProfile && (
            <div className="mt-2 flex gap-2">
              <input
                value={newProfileName}
                onChange={(event) => setNewProfileName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createProfile()
                  if (event.key === 'Escape') {
                    setShowNewProfile(false)
                    setNewProfileName('')
                  }
                }}
                autoFocus
                placeholder="New profile name"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={createProfile}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowNewProfile(false)
                  setNewProfileName('')
                }}
                className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-600">Profile name</span>
          <input
            value={cfg.profile.name}
            onChange={(event) => update({ ...cfg, profile: { ...cfg.profile, name: event.target.value } })}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-600">Admin PIN</span>
          <div className="flex gap-2">
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder={cfg.profile.admin_pin_hash ? 'PIN configured' : 'Set 4-12 digit PIN'}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <button onClick={savePin} className="px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-semibold">
              Save PIN
            </button>
          </div>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
        <button onClick={exportPackage} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold">
          Export Settings Package
        </button>
        <button onClick={() => importPackage(false)} className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold">
          Import Settings Package
        </button>
        <button onClick={() => importPackage(true)} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold border border-red-200">
          Force Replace Import
        </button>
      </div>

      {status && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{status}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="text-xs font-bold uppercase text-slate-500">Modules</span>
            <button
              onClick={() => {
                setShowNewModule((value) => !value)
                setError(null)
              }}
              className="text-xs text-blue-600 font-semibold"
            >
              Add
            </button>
          </div>
          {showNewModule && (
            <div className="p-3 border-b border-slate-100 bg-blue-50 flex flex-col gap-2">
              <input
                value={newModuleCode}
                onChange={(event) => setNewModuleCode(event.target.value.toUpperCase().slice(0, 2))}
                placeholder="Code, e.g. AS"
                className="border border-blue-200 rounded-lg px-2 py-1 text-sm bg-white"
              />
              <input
                value={newModuleName}
                onChange={(event) => setNewModuleName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addModule()
                  if (event.key === 'Escape') {
                    setShowNewModule(false)
                    setNewModuleCode('')
                    setNewModuleName('')
                  }
                }}
                autoFocus
                placeholder="Module name"
                className="border border-blue-200 rounded-lg px-2 py-1 text-sm bg-white"
              />
              <div className="flex gap-2">
                <button onClick={addModule} className="flex-1 px-2 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold">
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewModule(false)
                    setNewModuleCode('')
                    setNewModuleName('')
                  }}
                  className="flex-1 px-2 py-1 bg-white text-slate-600 rounded-lg text-xs font-semibold border border-blue-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {cfg.modules.map((m) => (
            <button
              key={m.code}
              onClick={() => {
                setSelectedModule(m.code)
                setSelectedStation(m.stations[0]?.station_number ?? null)
              }}
              className={`w-full text-left px-3 py-2 border-b border-slate-100 text-sm ${selectedModule === m.code ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}
            >
              {m.name} <span className="text-slate-400">({m.code})</span>
            </button>
          ))}
        </div>

        {mod && (
          <div className="flex flex-col gap-4">
            <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{mod.name}</h3>
                <button onClick={() => deleteModule(mod.code)} className="text-xs text-red-600 font-semibold">Delete Module</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-500">Name</span>
                  <input
                    value={mod.name}
                    onChange={(event) => update({ ...cfg, modules: cfg.modules.map((m) => m.code === mod.code ? { ...m, name: event.target.value } : m) })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className="text-xs font-semibold text-slate-500">Aliases</span>
                  <input
                    value={mod.aliases.join(', ')}
                    onChange={(event) => update({ ...cfg, modules: cfg.modules.map((m) => m.code === mod.code ? { ...m, aliases: event.target.value.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean) } : m) })}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase text-slate-500 mr-2">Stations</span>
                {mod.stations.map((s) => (
                  <button
                    key={s.station_number}
                    onClick={() => setSelectedStation(s.station_number)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold ${selectedStation === s.station_number ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    Station {s.station_number}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setShowNewStation((value) => !value)
                    setError(null)
                  }}
                  className="px-3 py-1 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50"
                >
                  Add Station
                </button>
              </div>
              {showNewStation && (
                <div className="flex gap-2 items-center bg-blue-50 border border-blue-100 rounded-lg p-2">
                  <input
                    value={newStationNumber}
                    onChange={(event) => setNewStationNumber(event.target.value.replace(/\D/g, ''))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addStation()
                      if (event.key === 'Escape') {
                        setShowNewStation(false)
                        setNewStationNumber('')
                      }
                    }}
                    autoFocus
                    placeholder="Station number"
                    className="border border-blue-200 rounded-lg px-2 py-1 text-sm bg-white"
                  />
                  <button onClick={addStation} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold">
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setShowNewStation(false)
                      setNewStationNumber('')
                    }}
                    className="px-3 py-1 bg-white text-slate-600 rounded-lg text-xs font-semibold border border-blue-100"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {station && (
                <>
                  <input
                    value={station.label}
                    onChange={(event) => updateStationField('label', event.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-semibold"
                  />
                  <textarea
                    value={station.candidate_instructions ?? ''}
                    onChange={(event) => updateStationField('candidate_instructions', event.target.value)}
                    rows={5}
                    placeholder="Candidate instructions"
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase text-slate-500">Fields</span>
                    <button onClick={() => { setNewFieldType('score'); setNewFieldLabel(''); setError(null) }} className="text-xs text-blue-600 font-semibold">Add Score</button>
                    <button onClick={() => { setNewFieldType('text'); setNewFieldLabel(''); setError(null) }} className="text-xs text-blue-600 font-semibold">Add Text</button>
                  </div>
                  {newFieldType && (
                    <div className="flex gap-2 items-center bg-blue-50 border border-blue-100 rounded-lg p-2">
                      <input
                        value={newFieldLabel}
                        onChange={(event) => setNewFieldLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') addField(newFieldType)
                          if (event.key === 'Escape') {
                            setNewFieldType(null)
                            setNewFieldLabel('')
                          }
                        }}
                        autoFocus
                        placeholder={`${newFieldType === 'score' ? 'Score' : 'Text'} field label`}
                        className="flex-1 border border-blue-200 rounded-lg px-2 py-1 text-sm bg-white"
                      />
                      <button onClick={() => addField(newFieldType)} className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold">
                        Create
                      </button>
                      <button
                        onClick={() => {
                          setNewFieldType(null)
                          setNewFieldLabel('')
                        }}
                        className="px-3 py-1 bg-white text-slate-600 rounded-lg text-xs font-semibold border border-blue-100"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {station.form_fields.map((field) => (
                      <div key={field.field_id} className="grid grid-cols-1 md:grid-cols-[1fr_90px_90px_90px_80px] gap-2 items-center bg-slate-50 rounded-lg p-2">
                        <input
                          value={field.label}
                          onChange={(event) => updateField(field.field_id, { label: event.target.value })}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                        />
                        <span className="text-xs font-semibold text-slate-500 uppercase">{field.field_type}</span>
                        {field.field_type === 'score' ? (
                          <input
                            type="number"
                            value={field.max_score ?? 0}
                            onChange={(event) => updateField(field.field_id, { max_score: Number(event.target.value) })}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                        ) : <span />}
                        {field.field_type === 'score' ? (
                          <input
                            type="number"
                            value={field.tolerance}
                            onChange={(event) => updateField(field.field_id, { tolerance: Number(event.target.value) })}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                        ) : <span />}
                        <button onClick={() => deleteField(field.field_id)} className="text-xs text-red-600 font-semibold">Delete</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <h3 className="font-bold text-slate-800">Examiners</h3>
          {cfg.examiners.map((examiner, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_80px] gap-2">
              <input
                value={examiner.name}
                onChange={(event) => update({ ...cfg, examiners: cfg.examiners.map((e, i) => i === index ? { ...e, name: event.target.value } : e) })}
                className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
              />
              <input
                value={examiner.module_codes?.join(', ') ?? ''}
                placeholder="blank = all modules"
                onChange={(event) => update({ ...cfg, examiners: cfg.examiners.map((e, i) => i === index ? { ...e, module_codes: event.target.value.trim() ? event.target.value.split(',').map((m) => m.trim().toUpperCase()) : null } : e) })}
                className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
              />
              <button onClick={() => update({ ...cfg, examiners: cfg.examiners.filter((_, i) => i !== index) })} className="text-xs text-red-600 font-semibold">Delete</button>
            </div>
          ))}
          <button onClick={() => update({ ...cfg, examiners: [...cfg.examiners, { name: 'New Examiner', is_admin: false, module_codes: null }] })} className="text-sm text-blue-600 font-semibold text-left">
            Add examiner
          </button>
        </div>

        <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <h3 className="font-bold text-slate-800">Students</h3>
          <p className="text-xs text-slate-500">Paste rows as student_id, full_name, module codes. Module codes can be separated by spaces or semicolons.</p>
          <textarea
            value={studentPaste}
            onChange={(event) => setStudentPaste(event.target.value)}
            rows={6}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
            placeholder={'100123456, Jane Smith, AS FC\n100987654, Alex Jones, HD'}
          />
          <div className="flex items-center gap-3">
            <button onClick={pasteStudents} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold">
              Stage pasted students
            </button>
            <span className="text-sm text-slate-500">{cfg.students.length} students in profile</span>
          </div>
        </div>
      </div>
    </div>
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
          Send this file to the other examiner using the same assessment profile so they can import it.
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
          examiner. Their dynamic form responses will be merged into this database and agreement detection will run
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

// ── DICOM Sync panel ─────────────────────────────────────────────────────────

function DicomSyncPanel(): React.JSX.Element {
  const [orthancBaseUrl, setOrthancBaseUrl] = useState('http://192.168.1.200:8042')
  const [ohifBaseUrl, setOhifBaseUrl] = useState('http://192.168.1.200:3000')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; name?: string; version?: string; error?: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<DicomSyncResult | null>(null)
  const [unresolved, setUnresolved] = useState<DicomUnresolvedStudy[]>([])
  const [uploadFolder, setUploadFolder] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<DicomUploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cfg = {
    orthanc_base_url: orthancBaseUrl.trim(),
    ohif_base_url: ohifBaseUrl.trim()
  }

  const loadUnresolved = useCallback(async () => {
    const rows = await window.api.getDicomUnresolved(100)
    setUnresolved(rows)
  }, [])

  React.useEffect(() => {
    window.api.getDicomConfig().then((saved) => {
      if (saved?.orthanc_base_url) setOrthancBaseUrl(saved.orthanc_base_url)
      if (saved?.ohif_base_url) setOhifBaseUrl(saved.ohif_base_url)
    })
    loadUnresolved()
  }, [loadUnresolved])

  async function saveConfig(): Promise<void> {
    setError(null)
    if (!cfg.orthanc_base_url || !cfg.ohif_base_url) {
      setError('Both Orthanc and OHIF URLs are required.')
      return
    }
    try {
      await window.api.saveDicomConfig(cfg)
    } catch (err) {
      setError(String(err))
    }
  }

  async function testConnection(): Promise<void> {
    setTesting(true)
    setError(null)
    setTestResult(null)
    await saveConfig()
    const result = await window.api.testDicomConnection(cfg)
    setTestResult(result)
    setTesting(false)
  }

  async function runSync(): Promise<void> {
    setSyncing(true)
    setError(null)
    setSyncResult(null)
    await saveConfig()
    try {
      const result = await window.api.syncDicomStudies(cfg)
      setSyncResult(result)
      setUnresolved(result.unresolved_items)
    } catch (err) {
      setError(String(err))
    } finally {
      setSyncing(false)
    }
  }

  async function browseUploadFolder(): Promise<void> {
    const p = await window.api.selectFolder()
    if (p) setUploadFolder(p)
  }

  async function uploadFolderToOrthanc(): Promise<void> {
    if (!uploadFolder) return
    setUploading(true)
    setError(null)
    setUploadResult(null)
    await saveConfig()
    try {
      const result = await window.api.uploadDicomFolder(cfg, uploadFolder)
      setUploadResult(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">Hosted DICOM bridge</p>
        <p>
          This imports Orthanc study references only. It expects DICOM Patient ID values like{' '}
          <code className="bg-blue-100 px-1 rounded">153883-AS-08</code>, links matched studies to
          the student register, and builds OHIF study URLs for marking. Image files are not copied
          to examiner machines.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UrlField
          label="Orthanc REST URL"
          value={orthancBaseUrl}
          onChange={setOrthancBaseUrl}
          placeholder="https://images.example.org/orthanc"
        />
        <UrlField
          label="OHIF URL"
          value={ohifBaseUrl}
          onChange={setOhifBaseUrl}
          placeholder="https://images.example.org"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={saveConfig}
          className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300"
        >
          Save URLs
        </button>
        <button
          onClick={testConnection}
          disabled={testing || !orthancBaseUrl.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          {testing ? 'Testing...' : 'Test Orthanc'}
        </button>
        <button
          onClick={runSync}
          disabled={syncing || !orthancBaseUrl.trim() || !ohifBaseUrl.trim()}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-40"
        >
          {syncing ? 'Syncing studies...' : 'Sync DICOM Studies'}
        </button>
      </div>

      {testResult && (
        <div className={`rounded-lg px-4 py-3 text-sm ${
          testResult.success
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {testResult.success
            ? <>Connected to {testResult.name ?? 'Orthanc'} {testResult.version ? `(${testResult.version})` : ''}</>
            : <>Connection failed: {testResult.error}</>}
        </div>
      )}

      <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-bold text-slate-700 mb-1">Upload post-exam DICOM export</h3>
          <p className="text-sm text-slate-500">
            Select a folder exported from the ultrasound machine or local Orthanc. Each file is posted
            to the configured Orthanc <code className="bg-slate-100 px-1 rounded">/instances</code>{' '}
            endpoint. After upload, run DICOM sync to link studies to students.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={uploadFolder}
            placeholder="No DICOM export folder selected"
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 truncate"
          />
          <button
            onClick={browseUploadFolder}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700"
          >
            Browse
          </button>
        </div>
        <button
          onClick={uploadFolderToOrthanc}
          disabled={uploading || !uploadFolder || !orthancBaseUrl.trim()}
          className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-40"
        >
          {uploading ? 'Uploading DICOM files...' : 'Upload Folder to Orthanc'}
        </button>
        {uploadResult && (
          <div className={`rounded-lg p-4 text-sm ${
            uploadResult.errors > 0
              ? 'bg-amber-50 border border-amber-200'
              : 'bg-green-50 border border-green-200'
          }`}>
            <p className={`font-semibold mb-2 ${uploadResult.errors > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              Uploaded {uploadResult.uploaded} of {uploadResult.scanned} files
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-slate-700">
              <Metric label="Scanned" value={uploadResult.scanned} />
              <Metric label="Uploaded" value={uploadResult.uploaded} />
              <Metric label="Skipped" value={uploadResult.skipped} />
              <Metric label="Errors" value={uploadResult.errors} />
            </div>
            {uploadResult.errors > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-amber-700 font-medium">
                  Show rejected files
                </summary>
                <ul className="mt-2 space-y-1 text-xs max-h-44 overflow-y-auto">
                  {uploadResult.items
                    .filter((item) => item.status === 'error')
                    .map((item, idx) => (
                      <li key={`${item.path}-${idx}`}>
                        <span className="font-mono text-slate-600 break-all">{item.path}</span>
                        <br />
                        <span className="text-amber-800">{item.reason}</span>
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {syncResult && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
          <p className="font-semibold text-green-700 mb-3">DICOM sync complete</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-slate-700">
            <Metric label="Studies scanned" value={syncResult.studies_scanned} />
            <Metric label="Matched" value={syncResult.matched} />
            <Metric label="Unresolved" value={syncResult.unresolved} />
            <Metric label="Errors" value={syncResult.errors} />
          </div>
          {syncResult.links.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-green-700 font-medium">
                {syncResult.links.length} linked studies
              </summary>
              <ul className="mt-2 space-y-1 text-xs max-h-44 overflow-y-auto">
                {syncResult.links.map((link) => (
                  <li key={link.id} className="font-mono text-slate-600 break-all">
                    {link.student_id} {link.module_code} Stn {link.station_number}: {link.study_instance_uid}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-700">Unresolved DICOM studies</h3>
          <button
            onClick={loadUnresolved}
            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700"
          >
            Refresh
          </button>
        </div>
        {unresolved.length === 0 ? (
          <p className="text-sm text-slate-400 border border-slate-200 rounded-lg px-4 py-6 text-center">
            No unresolved studies recorded.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Seen</th>
                  <th className="px-4 py-3 text-left font-semibold">Patient ID</th>
                  <th className="px-4 py-3 text-left font-semibold">Reason</th>
                  <th className="px-4 py-3 text-left font-semibold">Study UID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unresolved.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(item.seen_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{item.patient_id ?? 'N/A'}</td>
                    <td className="px-4 py-2 text-slate-700">{item.reason}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500 break-all">
                      {item.study_instance_uid ?? 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function UrlField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
      />
    </label>
  )
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="bg-white border border-green-100 rounded-lg px-3 py-2">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-lg font-bold text-slate-800">{value}</p>
    </div>
  )
}

// ── Main AdminPage ────────────────────────────────────────────────────────────

export default function AdminPage(): React.JSX.Element {
  const { setScreen, examinerName } = useAppStore()
  const [tab, setTab] = useState<AdminTab>('profile')
  const [cfg, setCfg] = useState<ProfileConfig | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  React.useEffect(() => {
    window.api.getActiveProfileConfig().then((next) => {
      setCfg(next)
      setUnlocked(!next?.profile.admin_pin_hash)
    })
  }, [])

  async function unlock(): Promise<void> {
    if (!cfg) return
    const ok = await window.api.verifyAdminPin(cfg.profile.id, pinInput)
    if (ok) {
      setUnlocked(true)
      setPinError(null)
    } else {
      setPinError('Incorrect admin PIN.')
    }
  }

  if (cfg && !unlocked) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow p-6 w-full max-w-sm flex flex-col gap-4">
          <h1 className="text-xl font-bold text-slate-800">Admin PIN Required</h1>
          <input
            value={pinInput}
            onChange={(event) => setPinInput(event.target.value)}
            type="password"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Admin PIN"
          />
          {pinError && <p className="text-sm text-red-600">{pinError}</p>}
          <div className="flex gap-2">
            <button onClick={() => setScreen(examinerName ? 'dashboard' : 'login')} className="flex-1 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-semibold">
              Cancel
            </button>
            <button onClick={unlock} className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
              Unlock
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Admin</h1>
        <button
          onClick={() => setScreen(examinerName ? 'dashboard' : 'login')}
          className="px-4 py-2 bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-300"
        >
          {examinerName ? 'Back to Dashboard' : 'Back to Login'}
        </button>
      </header>

      <main className="p-6 max-w-5xl mx-auto flex flex-col gap-4">
        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-xl shadow p-1 w-fit">
          <TabButton label="Assessment Profile" active={tab === 'profile'} onClick={() => setTab('profile')} />
          <TabButton label="Sort Files" active={tab === 'sort'} onClick={() => setTab('sort')} />
          <TabButton label="DICOM Sync" active={tab === 'dicom'} onClick={() => setTab('dicom')} />
          <TabButton label="Image Audit" active={tab === 'audit'} onClick={() => setTab('audit')} />
          <TabButton label="Sync Marks" active={tab === 'sync'} onClick={() => setTab('sync')} />
          <TabButton label="Reset Marks" active={tab === 'reset'} onClick={() => setTab('reset')} colour="red" />
        </div>

        {/* Panel */}
        <div className="bg-white rounded-2xl shadow p-6">
          {tab === 'profile' && <ProfilePanel />}
          {tab === 'sort' && <SortPanel />}
          {tab === 'dicom' && <DicomSyncPanel />}
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
