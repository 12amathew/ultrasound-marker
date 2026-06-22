import React, { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import ImageViewer from '../components/ImageViewer'
import type {
  AuditEntry,
  CsvStudentPreviewResult,
  CsvStudentPreviewRow,
  DicomStudyLink,
  DicomStudyPreview,
  DicomSyncResult,
  DicomUnresolvedStudy,
  DicomUnresolvedStudyDetails,
  DicomUploadResult,
  FileSortResult,
  ImportResult,
  ProfileConfig,
  StationFormField
} from '../types/ipc'

type AdminTab = 'profile' | 'sort' | 'dicom' | 'audit' | 'sync' | 'reset'
type ProfileModule = ProfileConfig['modules'][number]
type ProfileStation = ProfileModule['stations'][number]
type ProfileStudent = ProfileConfig['students'][number]

type PendingStudentImport = {
  result: CsvStudentPreviewResult
  duplicateRowKeys: Set<number>
  excludedRowKeys: Set<number>
}

// ── Status helpers ────────────────────────────────────────────────────────────

function entryStatus(e: AuditEntry): 'ok' | 'partial' | 'missing' {
  const hasCompleteDicomImages = (e.active_dicom_link?.preview_count ?? 0) >= 2
  const hasCompleteLocalImages = Boolean(e.img1 && e.img2)
  const hasImages = hasCompleteDicomImages || (!e.active_dicom_link && hasCompleteLocalImages)
  const hasRequired = hasImages && (!e.requires_conclusion || e.conclusion)
  if (hasRequired) return 'ok'
  if (e.active_dicom_link || e.img1 || e.img2 || e.conclusion) return 'partial'
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
  const [resolverEntry, setResolverEntry] = useState<AuditEntry | null>(null)
  const [refreshingLinkId, setRefreshingLinkId] = useState<number | null>(null)
  const [unlinkingLinkId, setUnlinkingLinkId] = useState<number | null>(null)

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

  async function handleRefreshDicom(link: DicomStudyLink): Promise<void> {
    setLinkError(null)
    setRefreshingLinkId(link.id)
    try {
      await window.api.refreshDicomLinkPreviewState(link.id)
      await load()
    } catch (err) {
      setLinkError(`Failed to refresh DICOM preview state: ${String(err)}`)
    } finally {
      setRefreshingLinkId(null)
    }
  }

  async function handleUnlinkDicom(link: DicomStudyLink): Promise<void> {
    const restore = window.confirm(
      'Restore this DICOM study to the unresolved candidate list after unlinking? Press Cancel to unlink and remove it from the resolver list.'
    )
    setLinkError(null)
    setUnlinkingLinkId(link.id)
    try {
      const result = await window.api.unlinkDicomStudyLink(link.id, restore)
      if (!result?.success) {
        setLinkError(`Failed to unlink DICOM study: ${result?.error ?? 'Unknown error'}`)
      }
      await load()
    } catch (err) {
      setLinkError(`Failed to unlink DICOM study: ${String(err)}`)
    } finally {
      setUnlinkingLinkId(null)
    }
  }

  async function handleDicomLinked(): Promise<void> {
    setResolverEntry(null)
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
                <th className="px-4 py-3 text-left font-semibold">DICOM</th>
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
                    <td className="px-4 py-2.5 min-w-[220px]">
                      <DicomAuditCell
                        entry={e}
                        refreshing={refreshingLinkId === e.active_dicom_link?.id}
                        unlinking={unlinkingLinkId === e.active_dicom_link?.id}
                        onResolve={() => setResolverEntry(e)}
                        onRefresh={handleRefreshDicom}
                        onUnlink={handleUnlinkDicom}
                      />
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
        Local files are copied into the correct student/station folder. Linked DICOM studies are the active image source for marking.
      </p>

      {resolverEntry && (
        <DicomResolverDialog
          entry={resolverEntry}
          onClose={() => setResolverEntry(null)}
          onLinked={handleDicomLinked}
        />
      )}
    </div>
  )
}

function DicomAuditCell({
  entry,
  refreshing,
  unlinking,
  onResolve,
  onRefresh,
  onUnlink
}: {
  entry: AuditEntry
  refreshing: boolean
  unlinking: boolean
  onResolve: () => void
  onRefresh: (link: DicomStudyLink) => void
  onUnlink: (link: DicomStudyLink) => void
}): React.JSX.Element {
  const link = entry.active_dicom_link
  if (!link) {
    return (
      <button
        onClick={onResolve}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
      >
        Link DICOM
      </button>
    )
  }

  const previewCount = link.preview_count
  const state =
    previewCount === null || previewCount === undefined
      ? 'unknown'
      : previewCount >= 2
        ? 'ready'
        : 'partial'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <DicomStateBadge state={state} />
        <span className="text-xs font-mono text-slate-600 truncate" title={link.patient_id}>
          {link.patient_id}
        </span>
      </div>
      <p className="text-[11px] text-slate-500">
        {previewCount === null || previewCount === undefined
          ? 'Preview status not checked'
          : `${previewCount} preview image${previewCount === 1 ? '' : 's'} available`}
      </p>
      {link.preview_error && (
        <p className="text-[11px] text-amber-700 line-clamp-2" title={link.preview_error}>
          {link.preview_error}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => onRefresh(link)}
          disabled={refreshing}
          className="px-2 py-1 rounded border border-slate-300 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        <button
          onClick={() => onUnlink(link)}
          disabled={unlinking}
          className="px-2 py-1 rounded border border-red-200 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
        >
          {unlinking ? 'Unlinking...' : 'Unlink'}
        </button>
        {entry.dicom_links.length > 1 && (
          <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs">
            {entry.dicom_links.length} links
          </span>
        )}
      </div>
    </div>
  )
}

function DicomStateBadge({ state }: { state: 'ready' | 'partial' | 'unknown' }): React.JSX.Element {
  const styles = {
    ready: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    unknown: 'bg-slate-100 text-slate-600'
  }
  const labels = {
    ready: 'DICOM ready',
    partial: 'DICOM partial',
    unknown: 'DICOM unknown'
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${styles[state]}`}>
      {labels[state]}
    </span>
  )
}

function parseRawDicomMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

function rawTag(raw: Record<string, unknown> | null, group: string, key: string): string | null {
  const section = raw?.[group]
  if (!section || typeof section !== 'object') return null
  const value = (section as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function formatDicomDate(value: string | null | undefined): string {
  if (!value) return 'N/A'
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  return value
}

function DicomResolverDialog({
  entry,
  onClose,
  onLinked
}: {
  entry: AuditEntry
  onClose: () => void
  onLinked: () => void
}): React.JSX.Element {
  const [items, setItems] = useState<DicomUnresolvedStudy[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [details, setDetails] = useState<DicomUnresolvedStudyDetails | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const loadItems = useCallback(async () => {
    setLoadingList(true)
    setError(null)
    try {
      const rows = await window.api.getDicomUnresolved(500)
      setItems(rows)
      setSelectedId(rows[0]?.id ?? null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoadingList(false)
    }
  }, [])

  React.useEffect(() => {
    loadItems()
  }, [loadItems])

  React.useEffect(() => {
    if (!selectedId) {
      setDetails(null)
      return
    }

    let cancelled = false
    async function loadDetails(): Promise<void> {
      setLoadingDetails(true)
      setError(null)
      try {
        const next = await window.api.getDicomUnresolvedDetails(selectedId)
        if (!cancelled) setDetails(next)
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoadingDetails(false)
      }
    }
    loadDetails()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const filtered = items.filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [
      item.patient_id,
      item.study_instance_uid,
      item.reason,
      item.orthanc_study_id
    ].some((value) => value?.toLowerCase().includes(q))
  })

  async function linkSelected(): Promise<void> {
    if (!selectedId) return
    setLinking(true)
    setError(null)
    try {
      const result = await window.api.linkUnresolvedDicomToStation(
        selectedId,
        entry.student_id,
        entry.module_code,
        entry.station_number
      )
      if (!result?.success) {
        setError(result?.error ?? 'Failed to link DICOM study.')
        return
      }
      await onLinked()
    } catch (err) {
      setError(String(err))
    } finally {
      setLinking(false)
    }
  }

  const raw = parseRawDicomMetadata(details?.unresolved.raw_metadata ?? null)
  const studyDescription =
    details?.study_description ?? rawTag(raw, 'MainDicomTags', 'StudyDescription') ?? 'N/A'
  const studyDate =
    details?.study_date ?? rawTag(raw, 'MainDicomTags', 'StudyDate') ?? null
  const modality = details?.modality ?? rawTag(raw, 'MainDicomTags', 'Modality') ?? 'N/A'
  const selected = details?.unresolved ?? items.find((item) => item.id === selectedId) ?? null

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800">Link DICOM study</h2>
            <p className="text-sm text-slate-500 truncate">
              {entry.full_name} · {entry.student_id} · {entry.module_code} Stn {entry.station_number}
            </p>
          </div>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mx-5 mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-0 min-h-0 flex-1">
          <div className="border-r border-slate-200 flex flex-col min-h-0">
            <div className="p-4 border-b border-slate-200">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search patient ID, UID, reason"
                className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700"
              />
            </div>
            {loadingList ? (
              <div className="p-6 text-sm text-slate-400">Loading unresolved studies...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-slate-400">No unresolved DICOM studies match.</div>
            ) : (
              <div className="overflow-y-auto divide-y divide-slate-100">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${
                      selectedId === item.id ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {item.patient_id ?? 'No Patient ID'}
                    </p>
                    <p className="text-xs text-slate-500 line-clamp-2">{item.reason}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {new Date(item.seen_at).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-5 flex flex-col gap-4 min-h-0 overflow-y-auto">
            {!selected ? (
              <div className="text-sm text-slate-400">Select an unresolved study to preview it.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <MetadataLine label="Patient ID" value={selected.patient_id ?? 'N/A'} mono />
                  <MetadataLine label="Study date" value={formatDicomDate(studyDate)} />
                  <MetadataLine label="Description" value={studyDescription} />
                  <MetadataLine label="Modality" value={modality} />
                  <MetadataLine
                    label="Series / instances"
                    value={
                      details?.series_count === null || details?.series_count === undefined
                        ? 'N/A'
                        : `${details.series_count} / ${details.instance_count ?? 'N/A'}`
                    }
                  />
                  <MetadataLine label="Study UID" value={selected.study_instance_uid ?? 'N/A'} mono />
                </div>

                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  {selected.reason}
                </div>

                {loadingDetails ? (
                  <div className="h-72 flex items-center justify-center text-slate-400">
                    Loading DICOM previews...
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <DicomPreviewTile preview={details?.previews[0] ?? null} label="Preview 1" />
                      <DicomPreviewTile preview={details?.previews[1] ?? null} label="Preview 2" />
                    </div>
                    {details?.error && (
                      <p className="text-xs text-amber-700">
                        Preview warning: {details.error}
                      </p>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={linkSelected}
                    disabled={linking || loadingDetails || !selectedId}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {linking ? 'Linking...' : 'Link to station'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetadataLine({
  label,
  value,
  mono = false
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <p className={`text-slate-700 truncate ${mono ? 'font-mono text-xs' : 'text-sm'}`} title={value}>
        {value}
      </p>
    </div>
  )
}

function DicomPreviewTile({
  preview,
  label
}: {
  preview: DicomStudyPreview | null
  label: string
}): React.JSX.Element {
  return (
    <ImageViewer
      dataUrl={preview?.dataUrl ?? null}
      label={label}
      className="h-72 rounded-lg overflow-hidden"
    />
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
  const [studentSearch, setStudentSearch] = useState('')
  const [studentModuleFilter, setStudentModuleFilter] = useState('ALL')
  const [studentImportPath, setStudentImportPath] = useState('')
  const [studentImporting, setStudentImporting] = useState(false)
  const [studentImportResult, setStudentImportResult] = useState<CsvStudentPreviewResult | null>(null)
  const [pendingStudentImport, setPendingStudentImport] = useState<PendingStudentImport | null>(null)
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

  function isConclusionField(field: StationFormField): boolean {
    return field.field_id.toUpperCase().includes('CONCLUSION')
  }

  function orderStationFields(fields: StationFormField[]): StationFormField[] {
    const rubricFields = fields.filter((field) => !isConclusionField(field))
    const localFields = fields.filter(isConclusionField)
    return [
      ...rubricFields.map((field, index) => ({ ...field, sort_order: index })),
      ...localFields.map((field, index) => ({ ...field, sort_order: rubricFields.length + index }))
    ]
  }

  function cloneRubricField(field: StationFormField, sortOrder: number): StationFormField {
    return {
      ...field,
      min_score: field.field_type === 'score' ? field.min_score ?? 0 : null,
      max_score: field.field_type === 'score' ? field.max_score ?? 10 : null,
      tolerance: field.tolerance ?? 1,
      required: field.field_type === 'score' ? true : field.required,
      sort_order: sortOrder
    }
  }

  function defaultRubricFields(): StationFormField[] {
    return [
      { field_id: 'IMG1', label: 'Image 1', field_type: 'score', min_score: 0, max_score: 10, tolerance: 1, required: true, sort_order: 0 },
      { field_id: 'IMG2', label: 'Image 2', field_type: 'score', min_score: 0, max_score: 10, tolerance: 1, required: true, sort_order: 1 }
    ]
  }

  function rubricTemplateForStation(stationNumber: number): StationFormField[] {
    const source = cfg?.modules
      .flatMap((module) => module.stations)
      .find((candidate) => candidate.station_number === stationNumber)
    const fields = source?.form_fields.filter((field) => !isConclusionField(field)) ?? []
    return (fields.length > 0 ? fields : defaultRubricFields()).map(cloneRubricField)
  }

  function defaultStation(moduleCode: string, stationNumber: number, rubricFields: StationFormField[]): ProfileStation {
    return {
      module_code: moduleCode,
      station_number: stationNumber,
      label: `Station ${stationNumber}`,
      candidate_instructions: '',
      form_fields: orderStationFields(rubricFields.map(cloneRubricField))
    }
  }

  function stationHasConclusion(target: ProfileStation): boolean {
    return target.form_fields.some(isConclusionField)
  }

  function conclusionField(sortOrder: number): StationFormField {
    return {
      field_id: 'CONCLUSION',
      label: 'Conclusion',
      field_type: 'score',
      min_score: 0,
      max_score: 1,
      tolerance: 1,
      required: true,
      sort_order: sortOrder
    }
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
    const stationNumbers = [...new Set(cfg.modules.flatMap((m) => m.stations.map((s) => s.station_number)))]
      .sort((a, b) => a - b)
    const next = {
      ...cfg,
      modules: [
        ...cfg.modules,
        {
          code,
          name,
          aliases: [code],
          stations: stationNumbers.map((stationNumber) =>
            defaultStation(code, stationNumber, rubricTemplateForStation(stationNumber))
          )
        }
      ]
    }
    update(next)
    setSelectedModule(code)
    setSelectedStation(stationNumbers[0] ?? null)
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
    if (cfg.modules.every((m) => m.stations.some((s) => s.station_number === n))) {
      setError(`Station ${n} already exists on every module.`)
      return
    }
    setError(null)
    const rubricFields = rubricTemplateForStation(n)
    const next = {
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.stations.some((s) => s.station_number === n)
          ? m
          : { ...m, stations: [...m.stations, defaultStation(m.code, n, rubricFields)] }
      )
    }
    update(next)
    setSelectedStation(n)
    setNewStationNumber('')
    setShowNewStation(false)
    setStatus(`Station ${n} staged for all modules. Click Save Profile to persist it.`)
  }

  function deleteStation(stationNumber: number): void {
    if (!cfg) return
    if (!window.confirm(`Delete Station ${stationNumber} from every module in this profile?`)) return
    const nextModules = cfg.modules.map((m) => ({
      ...m,
      stations: m.stations.filter((s) => s.station_number !== stationNumber)
    }))
    update({ ...cfg, modules: nextModules })
    setSelectedStation(nextModules.find((m) => m.code === selectedModule)?.stations[0]?.station_number ?? null)
    setStatus(`Station ${stationNumber} deletion staged for all modules. Save profile to apply.`)
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
    const matchingStations = cfg.modules.flatMap((m) =>
      m.stations.filter((s) => s.station_number === station.station_number)
    )
    if (matchingStations.some((s) => s.form_fields.some((field) => field.field_id === fieldId))) {
      setError(`A field with ID ${fieldId} already exists on Station ${station.station_number}.`)
      return
    }
    setError(null)
    const newField: StationFormField = {
      field_id: fieldId,
      label,
      field_type: type,
      min_score: type === 'score' ? 0 : null,
      max_score: type === 'score' ? 10 : null,
      tolerance: 1,
      required: type === 'score',
      sort_order: station.form_fields.filter((field) => !isConclusionField(field)).length
    }
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        ({
          ...m,
          stations: m.stations.map((s) =>
            s.station_number === station.station_number
              ? { ...s, form_fields: orderStationFields([...s.form_fields, newField]) }
              : s
          )
        })
      )
    })
    setNewFieldType(null)
    setNewFieldLabel('')
    setStatus(`${type === 'score' ? 'Score' : 'Text'} field staged for Station ${station.station_number} in all modules. Click Save Profile to persist it.`)
  }

  function updateField(fieldId: string, patch: Partial<StationFormField>): void {
    if (!cfg || !mod || !station) return
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        ({
          ...m,
          stations: m.stations.map((s) =>
            s.station_number === station.station_number
              ? {
                  ...s,
                  form_fields: orderStationFields(
                    s.form_fields.map((f) => (f.field_id === fieldId && !isConclusionField(f) ? { ...f, ...patch } : f))
                  )
                }
              : s
          )
        })
      )
    })
  }

  function deleteField(fieldId: string): void {
    if (!cfg || !mod || !station) return
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        ({
          ...m,
          stations: m.stations.map((s) =>
            s.station_number === station.station_number
              ? { ...s, form_fields: orderStationFields(s.form_fields.filter((f) => f.field_id !== fieldId || isConclusionField(f))) }
              : s
          )
        })
      )
    })
  }

  function toggleConclusion(enabled: boolean): void {
    if (!cfg || !mod || !station) return
    update({
      ...cfg,
      modules: cfg.modules.map((m) =>
        m.code === mod.code
          ? {
              ...m,
              stations: m.stations.map((s) => {
                if (s.station_number !== station.station_number) return s
                const withoutConclusion = s.form_fields.filter((field) => !isConclusionField(field))
                return {
                  ...s,
                  form_fields: orderStationFields(
                    enabled ? [...withoutConclusion, conclusionField(withoutConclusion.length)] : withoutConclusion
                  )
                }
              })
            }
          : m
      )
    })
    setStatus(
      enabled
        ? `Conclusion form enabled for ${mod.code} Station ${station.station_number}. Save profile to apply.`
        : `Conclusion form disabled for ${mod.code} Station ${station.station_number}. Save profile to apply.`
    )
  }

  function cleanStudentId(value: string): string {
    return value.replace(/\D/g, '')
  }

  function normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase()
  }

  function mergeStudentRows(rows: CsvStudentPreviewRow[]): void {
    if (!cfg || rows.length === 0) return
    const byId = new Map(cfg.students.map((student) => [student.student_id, student]))
    const order = cfg.students.map((student) => student.student_id)

    for (const row of rows) {
      const existing = byId.get(row.student_id)
      if (existing) {
        byId.set(row.student_id, {
          ...existing,
          full_name: existing.full_name.trim() ? existing.full_name : row.full_name,
          module_codes: [...new Set([...existing.module_codes, ...row.module_codes])]
        })
      } else {
        byId.set(row.student_id, {
          student_id: row.student_id,
          full_name: row.full_name,
          module_codes: [...new Set(row.module_codes)]
        })
        order.push(row.student_id)
      }
    }

    update({ ...cfg, students: order.map((studentId) => byId.get(studentId)!).filter(Boolean) })
    setStatus(`${rows.length} CSV student rows staged. Save profile to apply.`)
  }

  function findDuplicateImportRows(result: CsvStudentPreviewResult): Set<number> {
    if (!cfg) return new Set()
    const duplicateRows = new Set<number>()
    const existingIds = new Set(cfg.students.map((student) => student.student_id))
    const existingNames = new Map<string, string[]>()
    for (const student of cfg.students) {
      const name = normalizeName(student.full_name)
      if (!name) continue
      existingNames.set(name, [...(existingNames.get(name) ?? []), student.student_id])
    }

    const seenIds = new Map<string, number>()
    const seenNames = new Map<string, number>()
    for (const row of result.rows) {
      const normalizedName = normalizeName(row.full_name)
      const matchingNameIds = existingNames.get(normalizedName) ?? []
      if (
        existingIds.has(row.student_id) ||
        matchingNameIds.some((studentId) => studentId !== row.student_id) ||
        seenIds.has(row.student_id) ||
        (normalizedName && seenNames.has(normalizedName))
      ) {
        duplicateRows.add(row.row)
        const firstIdRow = seenIds.get(row.student_id)
        const firstNameRow = normalizedName ? seenNames.get(normalizedName) : undefined
        if (firstIdRow) duplicateRows.add(firstIdRow)
        if (firstNameRow) duplicateRows.add(firstNameRow)
      }
      seenIds.set(row.student_id, row.row)
      if (normalizedName) seenNames.set(normalizedName, row.row)
    }

    return duplicateRows
  }

  async function browseStudentCsv(): Promise<void> {
    const p = await window.api.selectFile([{ name: 'CSV', extensions: ['csv'] }])
    if (p) setStudentImportPath(p)
  }

  async function previewStudentImport(): Promise<void> {
    if (!cfg || !studentImportPath) return
    setStudentImporting(true)
    setError(null)
    setStatus(null)
    setStudentImportResult(null)
    try {
      const result = await window.api.previewStudentCsv(studentImportPath) as CsvStudentPreviewResult
      setStudentImportResult(result)
      if (result.rows.length === 0) {
        setError(result.errors[0]?.reason ?? 'No valid student rows found in CSV.')
        return
      }
      const duplicateRowKeys = findDuplicateImportRows(result)
      if (duplicateRowKeys.size > 0) {
        setPendingStudentImport({
          result,
          duplicateRowKeys,
          excludedRowKeys: new Set()
        })
        return
      }
      mergeStudentRows(result.rows)
      setStudentImportPath('')
    } catch (err) {
      setError(String(err))
    } finally {
      setStudentImporting(false)
    }
  }

  function confirmPendingStudentImport(): void {
    if (!pendingStudentImport) return
    const rows = pendingStudentImport.result.rows.filter((row) => !pendingStudentImport.excludedRowKeys.has(row.row))
    mergeStudentRows(rows)
    setStudentImportPath('')
    setPendingStudentImport(null)
  }

  function updateStudent(index: number, patch: Partial<ProfileStudent>): void {
    if (!cfg) return
    update({
      ...cfg,
      students: cfg.students.map((student, i) => (i === index ? { ...student, ...patch } : student))
    })
  }

  function toggleStudentModule(index: number, moduleCode: string): void {
    if (!cfg) return
    const student = cfg.students[index]
    if (!student) return
    const hasModule = student.module_codes.includes(moduleCode)
    const module_codes = hasModule
      ? student.module_codes.filter((code) => code !== moduleCode)
      : [...student.module_codes, moduleCode]
    updateStudent(index, { module_codes })
  }

  function addStudent(): void {
    if (!cfg) return
    update({
      ...cfg,
      students: [
        ...cfg.students,
        {
          student_id: '',
          full_name: '',
          module_codes: selectedModule ? [selectedModule] : []
        }
      ]
    })
    setStatus('Blank student row staged. Enter the details and save the profile.')
  }

  function deleteStudent(index: number): void {
    if (!cfg) return
    const student = cfg.students[index]
    if (!student) return
    if (!window.confirm(`Delete ${student.full_name || student.student_id || 'this student'} from the staged profile?`)) return
    update({ ...cfg, students: cfg.students.filter((_, i) => i !== index) })
    setStatus('Student deletion staged. Save profile to apply.')
  }

  if (!cfg) {
    return <div className="text-center text-slate-400 py-12">Loading profile...</div>
  }

  const moduleOptions = cfg.modules.map((module) => module.code)
  const filteredStudents = cfg.students
    .map((student, index) => ({ student, index }))
    .filter(({ student }) => {
      const q = studentSearch.trim().toLowerCase()
      if (studentModuleFilter !== 'ALL' && !student.module_codes.includes(studentModuleFilter)) return false
      if (!q) return true
      return (
        student.student_id.toLowerCase().includes(q) ||
        student.full_name.toLowerCase().includes(q) ||
        student.module_codes.join(' ').toLowerCase().includes(q)
      )
    })

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
                {station && (
                  <button
                    onClick={() => deleteStation(station.station_number)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold text-red-600 bg-red-50"
                  >
                    Delete Station
                  </button>
                )}
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
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={stationHasConclusion(station)}
                      onChange={(event) => toggleConclusion(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Requires conclusion form for {mod.code} Station {station.station_number}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase text-slate-500">Universal rubric fields</span>
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
                    <div className="hidden md:grid md:grid-cols-[1fr_80px_80px_80px_90px_80px] gap-2 px-2 text-xs font-semibold uppercase text-slate-400">
                      <span>Label</span>
                      <span>Type</span>
                      <span>Min</span>
                      <span>Max</span>
                      <span>Tolerance</span>
                      <span />
                    </div>
                    {station.form_fields.filter((field) => !isConclusionField(field)).map((field) => (
                      <div key={field.field_id} className="grid grid-cols-1 md:grid-cols-[1fr_80px_80px_80px_90px_80px] gap-2 items-center bg-slate-50 rounded-lg p-2">
                        <input
                          value={field.label}
                          onChange={(event) => updateField(field.field_id, { label: event.target.value })}
                          className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                        />
                        <span className="text-xs font-semibold text-slate-500 uppercase">{field.field_type}</span>
                        {field.field_type === 'score' ? (
                          <input
                            type="number"
                            value={field.min_score ?? 0}
                            onChange={(event) => updateField(field.field_id, { min_score: Number(event.target.value) })}
                            className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                          />
                        ) : <span />}
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

      <div className="grid grid-cols-1 gap-4">
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

        <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h3 className="font-bold text-slate-800">Students</h3>
              <p className="text-xs text-slate-500">
                CSV columns: full_name, student_id, module_code_1, module_code_2. Imports are staged until the profile is saved.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={studentImportPath}
                placeholder="No CSV selected"
                className="w-full sm:w-72 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 truncate"
              />
              <button
                onClick={browseStudentCsv}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-medium text-slate-700"
              >
                Browse CSV
              </button>
              <button
                onClick={previewStudentImport}
                disabled={!studentImportPath || studentImporting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40"
              >
                {studentImporting ? 'Checking...' : 'Import CSV'}
              </button>
            </div>
          </div>

          {studentImportResult && studentImportResult.errors.length > 0 && (
            <details className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
              <summary className="cursor-pointer font-semibold text-amber-800">
                {studentImportResult.errors.length} CSV row errors
              </summary>
              <ul className="mt-2 space-y-1 text-amber-800 max-h-44 overflow-y-auto">
                {studentImportResult.errors.map((rowError) => (
                  <li key={`${rowError.row}-${rowError.reason}`}>
                    Row {rowError.row}: {rowError.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <input
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              placeholder="Search name, student ID, or module"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2 flex-wrap">
              <FilterChip label="All modules" active={studentModuleFilter === 'ALL'} onClick={() => setStudentModuleFilter('ALL')} />
              {moduleOptions.map((code) => (
                <FilterChip key={code} label={code} active={studentModuleFilter === code} onClick={() => setStudentModuleFilter(code)} />
              ))}
            </div>
            <button
              onClick={addStudent}
              className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-semibold border border-blue-200"
            >
              Add student
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold w-40">Student ID</th>
                  <th className="px-3 py-3 text-left font-semibold min-w-64">Full name</th>
                  <th className="px-3 py-3 text-left font-semibold">Modules</th>
                  <th className="px-3 py-3 text-right font-semibold w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-slate-400">
                      No students match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map(({ student, index }) => (
                    <tr key={`${student.student_id || 'new'}-${index}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 align-top">
                        <input
                          value={student.student_id}
                          onChange={(event) => updateStudent(index, { student_id: cleanStudentId(event.target.value) })}
                          placeholder="9 digit ID"
                          className="w-36 border border-slate-300 rounded-lg px-2 py-1 text-sm font-mono"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input
                          value={student.full_name}
                          onChange={(event) => updateStudent(index, { full_name: event.target.value })}
                          placeholder="Full name"
                          className="w-full border border-slate-300 rounded-lg px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-2">
                          {moduleOptions.map((code) => (
                            <label
                              key={code}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${
                                student.module_codes.includes(code)
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-slate-200 bg-white text-slate-500'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={student.module_codes.includes(code)}
                                onChange={() => toggleStudentModule(index, code)}
                                className="h-3 w-3"
                              />
                              {code}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <button
                          onClick={() => deleteStudent(index)}
                          className="text-xs text-red-600 font-semibold"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-slate-500">
            Showing {filteredStudents.length} of {cfg.students.length} students. Edits, imports, and deletions are staged until Save Profile.
          </p>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Save staged profile changes before leaving admin.</p>
        <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>

      {pendingStudentImport && (
        <div className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Review possible duplicate students</h2>
                <p className="text-sm text-slate-500">
                  Duplicate rows are highlighted. Excluded rows will not be staged.
                </p>
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setPendingStudentImport(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-3 text-left font-semibold">Import</th>
                      <th className="px-3 py-3 text-left font-semibold">Row</th>
                      <th className="px-3 py-3 text-left font-semibold">Student ID</th>
                      <th className="px-3 py-3 text-left font-semibold">Full name</th>
                      <th className="px-3 py-3 text-left font-semibold">Modules</th>
                      <th className="px-3 py-3 text-left font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pendingStudentImport.result.rows.map((row) => {
                      const duplicate = pendingStudentImport.duplicateRowKeys.has(row.row)
                      const excluded = pendingStudentImport.excludedRowKeys.has(row.row)
                      const existingSameId = cfg.students.find((student) => student.student_id === row.student_id)
                      const existingSameName = cfg.students.find((student) =>
                        normalizeName(student.full_name) === normalizeName(row.full_name) && student.student_id !== row.student_id
                      )
                      const reason = existingSameId
                        ? `Existing ID: ${existingSameId.full_name}`
                        : existingSameName
                        ? `Name matches ID ${existingSameName.student_id}`
                        : 'Duplicate within CSV'

                      return (
                        <tr key={row.row} className={duplicate ? 'bg-amber-50' : ''}>
                          <td className="px-3 py-2">
                            {duplicate ? (
                              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={!excluded}
                                  onChange={() => {
                                    const next = new Set(pendingStudentImport.excludedRowKeys)
                                    if (next.has(row.row)) next.delete(row.row)
                                    else next.add(row.row)
                                    setPendingStudentImport({ ...pendingStudentImport, excludedRowKeys: next })
                                  }}
                                />
                                Include
                              </label>
                            ) : (
                              <span className="text-xs text-slate-400">Included</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.row}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.student_id}</td>
                          <td className="px-3 py-2 text-slate-700">{row.full_name}</td>
                          <td className="px-3 py-2 text-slate-600">{row.module_codes.join(', ')}</td>
                          <td className="px-3 py-2 text-amber-800">{duplicate ? reason : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingStudentImport(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmPendingStudentImport}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Stage selected rows
              </button>
            </div>
          </div>
        </div>
      )}
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
