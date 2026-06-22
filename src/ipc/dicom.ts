import type Database from 'better-sqlite3'
import { Buffer } from 'buffer'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getStudentByShortId, resolveModuleAlias } from '../db/queries'
import type {
  DicomParsedPatientId,
  DicomManualLinkResult,
  DicomServerConfig,
  DicomStudyLink,
  DicomStudyPreview,
  DicomStudyPreviews,
  DicomSyncResult,
  DicomUnlinkResult,
  DicomUploadItem,
  DicomUploadResult,
  DicomUnresolvedStudyDetails,
  DicomUnresolvedStudy
} from '../types/ipc'

interface OrthancStudyDetails {
  ID: string
  MainDicomTags?: Record<string, string>
  PatientMainDicomTags?: Record<string, string>
  Series?: string[]
}

interface OrthancSeriesDetails {
  ID: string
  MainDicomTags?: Record<string, string>
  Instances?: string[]
}

export function parseDicomPatientId(
  patientId: string | null | undefined,
  resolveModule: (moduleOrAlias: string) => string | null = (value) => value
): DicomParsedPatientId | null {
  if (!patientId) return null
  const match = /^(\d{6})-([A-Z]{2})-(\d{1,2})$/.exec(patientId.trim().toUpperCase())
  if (!match) return null
  const moduleCode = resolveModule(match[2])
  if (!moduleCode) return null
  return {
    student_short_id: match[1],
    module_code: moduleCode,
    station_number: Number.parseInt(match[3], 10)
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function buildOhifStudyUrl(ohifBaseUrl: string, studyInstanceUid: string): string {
  return `${normalizeBaseUrl(ohifBaseUrl)}/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUid)}`
}

async function orthancGet<T>(orthancBaseUrl: string, path: string): Promise<T> {
  const res = await fetch(`${normalizeBaseUrl(orthancBaseUrl)}${path}`)
  if (!res.ok) {
    throw new Error(`Orthanc ${path} failed with HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

async function orthancGetBinary(
  orthancBaseUrl: string,
  path: string
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(`${normalizeBaseUrl(orthancBaseUrl)}${path}`)
  if (!res.ok) {
    throw new Error(`Orthanc ${path} failed with HTTP ${res.status}`)
  }
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get('content-type')?.split(';')[0] ?? 'image/png'
  }
}

async function orthancPostDicomFile(orthancBaseUrl: string, filePath: string): Promise<void> {
  const bytes = readFileSync(filePath)
  const res = await fetch(`${normalizeBaseUrl(orthancBaseUrl)}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/dicom' },
    body: new Uint8Array(bytes)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`)
  }
}

function collectUploadCandidateFiles(dirPath: string): string[] {
  const files: string[] = []

  function scan(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry === '.DS_Store') continue
      const fullPath = join(dir, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        scan(fullPath)
      } else if (stat.isFile() && stat.size > 0) {
        files.push(fullPath)
      }
    }
  }

  scan(dirPath)
  files.sort((a, b) => a.localeCompare(b))
  return files
}

export async function uploadDicomFolderToOrthanc(
  cfg: DicomServerConfig,
  folderPath: string
): Promise<DicomUploadResult> {
  const files = collectUploadCandidateFiles(folderPath)
  const items: DicomUploadItem[] = []
  let uploaded = 0
  let skipped = 0
  let errors = 0

  for (const filePath of files) {
    try {
      await orthancPostDicomFile(cfg.orthanc_base_url, filePath)
      uploaded++
      items.push({ path: filePath, status: 'uploaded' })
    } catch (err) {
      errors++
      items.push({ path: filePath, status: 'error', reason: String(err) })
    }
  }

  return {
    scanned: files.length,
    uploaded,
    skipped,
    errors,
    items
  }
}

export function getDicomServerConfig(db: Database.Database): DicomServerConfig | null {
  const row = db
    .prepare('SELECT orthanc_base_url, ohif_base_url FROM dicom_server_config WHERE id = 1')
    .get() as DicomServerConfig | undefined
  return row ?? null
}

export function saveDicomServerConfig(db: Database.Database, cfg: DicomServerConfig): DicomServerConfig {
  const clean = {
    orthanc_base_url: normalizeBaseUrl(cfg.orthanc_base_url),
    ohif_base_url: normalizeBaseUrl(cfg.ohif_base_url)
  }
  db.prepare(`
    INSERT INTO dicom_server_config (id, orthanc_base_url, ohif_base_url, configured_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      orthanc_base_url = excluded.orthanc_base_url,
      ohif_base_url = excluded.ohif_base_url,
      configured_at = excluded.configured_at
  `).run(clean.orthanc_base_url, clean.ohif_base_url, new Date().toISOString())
  return clean
}

export async function testOrthancConnection(
  cfg: DicomServerConfig
): Promise<{ success: boolean; name?: string; version?: string; error?: string }> {
  try {
    const system = await orthancGet<Record<string, string>>(cfg.orthanc_base_url, '/system')
    return {
      success: true,
      name: system.Name,
      version: system.Version
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function insertUnresolved(
  db: Database.Database,
  runId: number | null,
  studyId: string | null,
  patientId: string | null,
  studyInstanceUid: string | null,
  reason: string,
  rawMetadata: unknown
): DicomUnresolvedStudy {
  const seenAt = new Date().toISOString()
  const result = db.prepare(`
    INSERT INTO dicom_unresolved_studies
      (run_id, orthanc_study_id, patient_id, study_instance_uid, reason, raw_metadata, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    studyId,
    patientId,
    studyInstanceUid,
    reason,
    rawMetadata === null || rawMetadata === undefined ? null : JSON.stringify(rawMetadata),
    seenAt
  )
  return {
    id: Number(result.lastInsertRowid),
    run_id: runId,
    orthanc_study_id: studyId,
    patient_id: patientId,
    study_instance_uid: studyInstanceUid,
    reason,
    raw_metadata: rawMetadata === null || rawMetadata === undefined ? null : JSON.stringify(rawMetadata),
    seen_at: seenAt
  }
}

function rowToStudyLink(row: unknown): DicomStudyLink {
  return row as DicomStudyLink
}

async function refreshLinkPreviewState(
  db: Database.Database,
  linkId: number
): Promise<DicomStudyLink | null> {
  const link = db.prepare('SELECT * FROM dicom_study_links WHERE id = ?').get(linkId) as DicomStudyLink | undefined
  if (!link) return null

  const checkedAt = new Date().toISOString()
  const result = await getDicomStudyPreviews(db, link.orthanc_study_id, 2)
  const previewCount = result.previews.filter((preview) => Boolean(preview.dataUrl)).length
  const previewError = result.error ?? (previewCount < 2 ? `Only ${previewCount} preview image(s) available.` : null)

  db.prepare(`
    UPDATE dicom_study_links
    SET preview_count = ?, preview_error = ?, preview_checked_at = ?
    WHERE id = ?
  `).run(previewCount, previewError, checkedAt, linkId)

  return rowToStudyLink(db.prepare('SELECT * FROM dicom_study_links WHERE id = ?').get(linkId))
}

async function getStudySeriesSummary(
  orthancBaseUrl: string,
  study: OrthancStudyDetails
): Promise<{ seriesCount: number; instanceCount: number; modality: string | null }> {
  const seriesIds = study.Series ?? []
  let instanceCount = 0
  let modality: string | null = null

  for (const seriesId of seriesIds) {
    const series = await orthancGet<OrthancSeriesDetails>(orthancBaseUrl, `/series/${seriesId}`)
    instanceCount += series.Instances?.length ?? 0
    modality ??= series.MainDicomTags?.Modality ?? null
  }

  return { seriesCount: seriesIds.length, instanceCount, modality }
}

async function getInstanceFrameCount(orthancBaseUrl: string, instanceId: string): Promise<number> {
  try {
    const tags = await orthancGet<Record<string, unknown>>(
      orthancBaseUrl,
      `/instances/${encodeURIComponent(instanceId)}/tags?simplify`
    )
    const numberOfFrames = tags.NumberOfFrames
    const parsed =
      typeof numberOfFrames === 'number'
        ? numberOfFrames
        : typeof numberOfFrames === 'string'
          ? Number.parseInt(numberOfFrames, 10)
          : 1
    return Number.isFinite(parsed) && parsed > 1 ? parsed : 1
  } catch {
    return 1
  }
}

export function getDicomLinksForStation(
  db: Database.Database,
  studentId: string,
  moduleCode: string,
  stationNumber: number
): DicomStudyLink[] {
  return db.prepare(`
    SELECT *
    FROM dicom_study_links
    WHERE student_id = ? AND module_code = ? AND station_number = ?
    ORDER BY imported_at DESC, id DESC
  `).all(studentId, moduleCode, stationNumber).map(rowToStudyLink)
}

export async function getDicomStudyPreview(
  db: Database.Database,
  orthancStudyId: string
): Promise<DicomStudyPreview> {
  const result = await getDicomStudyPreviews(db, orthancStudyId, 1)
  return result.previews[0] ?? {
    dataUrl: null,
    orthanc_study_id: orthancStudyId,
    orthanc_instance_id: null,
    content_type: null,
    image_index: 1,
    error: result.error ?? 'No previewable DICOM instances were found in this study.'
  }
}

export async function getDicomStudyPreviews(
  db: Database.Database,
  orthancStudyId: string,
  limit = 2
): Promise<DicomStudyPreviews> {
  const cfg = getDicomServerConfig(db)
  if (!cfg) {
    return {
      orthanc_study_id: orthancStudyId,
      previews: [],
      error: 'DICOM server is not configured.'
    }
  }

  try {
    const study = await orthancGet<OrthancStudyDetails>(
      cfg.orthanc_base_url,
      `/studies/${encodeURIComponent(orthancStudyId)}`
    )

    const previews: DicomStudyPreview[] = []
    const errors: string[] = []

    for (const seriesId of study.Series ?? []) {
      const series = await orthancGet<OrthancSeriesDetails>(
        cfg.orthanc_base_url,
        `/series/${encodeURIComponent(seriesId)}`
      )

      for (const instanceId of series.Instances ?? []) {
        const frameCount = await getInstanceFrameCount(cfg.orthanc_base_url, instanceId)
        const previewTargets =
          frameCount > 1
            ? Array.from({ length: frameCount }, (_, frameIndex) => ({
                path: `/instances/${encodeURIComponent(instanceId)}/frames/${frameIndex}/preview`,
                frameIndex
              }))
            : [{ path: `/instances/${encodeURIComponent(instanceId)}/preview`, frameIndex: null }]

        for (const target of previewTargets) {
          if (previews.length >= limit) {
            return { orthanc_study_id: orthancStudyId, previews }
          }

          try {
            const preview = await orthancGetBinary(cfg.orthanc_base_url, target.path)
            const base64 = Buffer.from(preview.bytes).toString('base64')
            previews.push({
              dataUrl: `data:${preview.contentType};base64,${base64}`,
              orthanc_study_id: orthancStudyId,
              orthanc_instance_id: instanceId,
              orthanc_frame_index: target.frameIndex,
              content_type: preview.contentType,
              image_index: previews.length + 1
            })
          } catch (err) {
            errors.push(String(err))
          }
        }

        try {
          if (frameCount > 1 && previews.length === 0) {
            const preview = await orthancGetBinary(
              cfg.orthanc_base_url,
              `/instances/${encodeURIComponent(instanceId)}/preview`
            )
            const base64 = Buffer.from(preview.bytes).toString('base64')
            previews.push({
              dataUrl: `data:${preview.contentType};base64,${base64}`,
              orthanc_study_id: orthancStudyId,
              orthanc_instance_id: instanceId,
              orthanc_frame_index: null,
              content_type: preview.contentType,
              image_index: previews.length + 1
            })
          }
        } catch (err) {
          errors.push(String(err))
        }
      }
    }

    return {
      orthanc_study_id: orthancStudyId,
      previews,
      error: previews.length > 0
        ? undefined
        : errors[0] ?? 'No previewable DICOM instances were found in this study.'
    }
  } catch (err) {
    return {
      orthanc_study_id: orthancStudyId,
      previews: [],
      error: String(err)
    }
  }
}

export function getRecentDicomUnresolved(
  db: Database.Database,
  limit = 100
): DicomUnresolvedStudy[] {
  return db.prepare(`
    SELECT *
    FROM dicom_unresolved_studies
    ORDER BY seen_at DESC, id DESC
    LIMIT ?
  `).all(limit) as DicomUnresolvedStudy[]
}

export async function getDicomUnresolvedStudyDetails(
  db: Database.Database,
  unresolvedId: number
): Promise<DicomUnresolvedStudyDetails | null> {
  const unresolved = db
    .prepare('SELECT * FROM dicom_unresolved_studies WHERE id = ?')
    .get(unresolvedId) as DicomUnresolvedStudy | undefined
  if (!unresolved) return null

  let studyDescription: string | null = null
  let studyDate: string | null = null
  let modality: string | null = null
  let seriesCount: number | null = null
  let instanceCount: number | null = null

  if (unresolved.orthanc_study_id) {
    const cfg = getDicomServerConfig(db)
    if (cfg) {
      try {
        const study = await orthancGet<OrthancStudyDetails>(
          cfg.orthanc_base_url,
          `/studies/${encodeURIComponent(unresolved.orthanc_study_id)}`
        )
        const summary = await getStudySeriesSummary(cfg.orthanc_base_url, study)
        studyDescription = study.MainDicomTags?.StudyDescription ?? null
        studyDate = study.MainDicomTags?.StudyDate ?? null
        modality = summary.modality
        seriesCount = summary.seriesCount
        instanceCount = summary.instanceCount
      } catch {
        // Preview retrieval below will surface a usable error for the resolver.
      }
    }
  }

  const previewResult = unresolved.orthanc_study_id
    ? await getDicomStudyPreviews(db, unresolved.orthanc_study_id, 2)
    : { orthanc_study_id: '', previews: [], error: 'This unresolved item has no Orthanc study ID.' }

  return {
    unresolved,
    previews: previewResult.previews,
    error: previewResult.error,
    study_description: studyDescription,
    study_date: studyDate,
    modality,
    series_count: seriesCount,
    instance_count: instanceCount
  }
}

export async function refreshDicomLinkPreviewState(
  db: Database.Database,
  linkId: number
): Promise<DicomStudyLink | null> {
  return refreshLinkPreviewState(db, linkId)
}

export async function linkUnresolvedDicomStudyToStation(
  db: Database.Database,
  unresolvedId: number,
  studentId: string,
  moduleCode: string,
  stationNumber: number
): Promise<DicomManualLinkResult> {
  const cfg = getDicomServerConfig(db)
  if (!cfg) return { success: false, error: 'DICOM server is not configured.' }

  const unresolved = db
    .prepare('SELECT * FROM dicom_unresolved_studies WHERE id = ?')
    .get(unresolvedId) as DicomUnresolvedStudy | undefined
  if (!unresolved) return { success: false, error: 'Unresolved DICOM study was not found.' }
  if (!unresolved.orthanc_study_id) {
    return { success: false, error: 'This unresolved item has no Orthanc study ID to link.' }
  }

  const student = db.prepare(`
    SELECT student_id
    FROM students
    WHERE student_id = ? AND module_code = ?
  `).get(studentId, moduleCode) as { student_id: string } | undefined
  if (!student) {
    return { success: false, error: 'Target student/module was not found in the imported student list.' }
  }

  let study: OrthancStudyDetails
  try {
    study = await orthancGet<OrthancStudyDetails>(
      cfg.orthanc_base_url,
      `/studies/${encodeURIComponent(unresolved.orthanc_study_id)}`
    )
  } catch (err) {
    return { success: false, error: `Failed to inspect Orthanc study: ${String(err)}` }
  }

  const studyInstanceUid = unresolved.study_instance_uid ?? study.MainDicomTags?.StudyInstanceUID ?? null
  if (!studyInstanceUid) {
    return { success: false, error: 'StudyInstanceUID is missing; this study cannot be linked.' }
  }

  const duplicate = db.prepare(`
    SELECT *
    FROM dicom_study_links
    WHERE study_instance_uid = ? OR orthanc_study_id = ?
    LIMIT 1
  `).get(studyInstanceUid, unresolved.orthanc_study_id) as DicomStudyLink | undefined
  if (duplicate) {
    return {
      success: false,
      error: `This DICOM study is already linked to ${duplicate.student_id} ${duplicate.module_code} Stn ${duplicate.station_number}.`
    }
  }

  const summary = await getStudySeriesSummary(cfg.orthanc_base_url, study)
  const previewResult = await getDicomStudyPreviews(db, unresolved.orthanc_study_id, 2)
  const previewCount = previewResult.previews.filter((preview) => Boolean(preview.dataUrl)).length
  const previewError = previewResult.error ?? (previewCount < 2 ? `Only ${previewCount} preview image(s) available.` : null)
  const importedAt = new Date().toISOString()
  const patientId =
    unresolved.patient_id ??
    study.PatientMainDicomTags?.PatientID ??
    study.MainDicomTags?.PatientID ??
    'UNKNOWN'

  const insert = db.prepare(`
    INSERT INTO dicom_study_links
      (student_id, student_short_id, module_code, station_number, patient_id,
       study_instance_uid, orthanc_study_id, study_description, study_date, modality,
       series_count, instance_count, ohif_url, imported_at, preview_count,
       preview_error, preview_checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = insert.run(
    studentId,
    studentId.slice(-6),
    moduleCode,
    stationNumber,
    patientId,
    studyInstanceUid,
    unresolved.orthanc_study_id,
    study.MainDicomTags?.StudyDescription ?? null,
    study.MainDicomTags?.StudyDate ?? null,
    summary.modality,
    summary.seriesCount,
    summary.instanceCount,
    buildOhifStudyUrl(cfg.ohif_base_url, studyInstanceUid),
    importedAt,
    previewCount,
    previewError,
    importedAt
  )

  db.prepare('DELETE FROM dicom_unresolved_studies WHERE id = ?').run(unresolvedId)
  const link = rowToStudyLink(
    db.prepare('SELECT * FROM dicom_study_links WHERE id = ?').get(Number(result.lastInsertRowid))
  )

  return { success: true, link }
}

export function unlinkDicomStudyLink(
  db: Database.Database,
  linkId: number,
  restoreUnresolved: boolean
): DicomUnlinkResult {
  const link = db.prepare('SELECT * FROM dicom_study_links WHERE id = ?').get(linkId) as DicomStudyLink | undefined
  if (!link) return { success: false, error: 'DICOM link was not found.' }

  db.prepare('DELETE FROM dicom_study_links WHERE id = ?').run(linkId)

  if (!restoreUnresolved) return { success: true }

  const restored = insertUnresolved(
    db,
    null,
    link.orthanc_study_id,
    link.patient_id,
    link.study_instance_uid,
    `Manually unlinked from ${link.student_id} ${link.module_code} Stn ${link.station_number}`,
    {
      study_description: link.study_description,
      study_date: link.study_date,
      modality: link.modality,
      series_count: link.series_count,
      instance_count: link.instance_count
    }
  )

  return { success: true, restored_unresolved: restored }
}

export async function syncDicomStudies(
  db: Database.Database,
  cfg: DicomServerConfig
): Promise<DicomSyncResult> {
  const cleanCfg = saveDicomServerConfig(db, cfg)
  const runAt = new Date().toISOString()
  const runResult = db.prepare(`
    INSERT INTO dicom_import_runs
      (run_at, orthanc_base_url, ohif_base_url, studies_scanned, matched, unresolved, errors)
    VALUES (?, ?, ?, 0, 0, 0, 0)
  `).run(runAt, cleanCfg.orthanc_base_url, cleanCfg.ohif_base_url)
  const runId = Number(runResult.lastInsertRowid)

  const importedLinks: DicomStudyLink[] = []
  const unresolvedItems: DicomUnresolvedStudy[] = []
  let studiesScanned = 0
  let errors = 0

  try {
    const studyIds = await orthancGet<string[]>(cleanCfg.orthanc_base_url, '/studies')
    studiesScanned = studyIds.length

    for (const studyId of studyIds) {
      try {
        const study = await orthancGet<OrthancStudyDetails>(cleanCfg.orthanc_base_url, `/studies/${studyId}`)
        const patientId =
          study.PatientMainDicomTags?.PatientID ??
          study.MainDicomTags?.PatientID ??
          null
        const studyInstanceUid = study.MainDicomTags?.StudyInstanceUID ?? null
        const parsed = parseDicomPatientId(patientId, (value) => resolveModuleAlias(db, value))

        if (!parsed) {
          unresolvedItems.push(
            insertUnresolved(db, runId, studyId, patientId, studyInstanceUid, 'PatientID does not match ShortID-MODULE-STATION', {
              PatientID: patientId,
              MainDicomTags: study.MainDicomTags,
              PatientMainDicomTags: study.PatientMainDicomTags
            })
          )
          continue
        }

        if (!studyInstanceUid) {
          unresolvedItems.push(
            insertUnresolved(db, runId, studyId, patientId, null, 'StudyInstanceUID is missing', study)
          )
          continue
        }

        const student = getStudentByShortId(db, parsed.student_short_id, parsed.module_code)
        if (!student) {
          unresolvedItems.push(
            insertUnresolved(
              db,
              runId,
              studyId,
              patientId,
              studyInstanceUid,
              `No imported student matches short ID ${parsed.student_short_id} in module ${parsed.module_code}`,
              study
            )
          )
          continue
        }

        const summary = await getStudySeriesSummary(cleanCfg.orthanc_base_url, study)
        const ohifUrl = buildOhifStudyUrl(cleanCfg.ohif_base_url, studyInstanceUid)
        const importedAt = new Date().toISOString()

        db.prepare(`
          INSERT INTO dicom_study_links
            (student_id, student_short_id, module_code, station_number, patient_id,
             study_instance_uid, orthanc_study_id, study_description, study_date, modality,
             series_count, instance_count, ohif_url, imported_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id, module_code, station_number, study_instance_uid)
          DO UPDATE SET
            patient_id = excluded.patient_id,
            orthanc_study_id = excluded.orthanc_study_id,
            study_description = excluded.study_description,
            study_date = excluded.study_date,
            modality = excluded.modality,
            series_count = excluded.series_count,
            instance_count = excluded.instance_count,
            ohif_url = excluded.ohif_url,
            imported_at = excluded.imported_at
        `).run(
          student.student_id,
          parsed.student_short_id,
          parsed.module_code,
          parsed.station_number,
          patientId,
          studyInstanceUid,
          studyId,
          study.MainDicomTags?.StudyDescription ?? null,
          study.MainDicomTags?.StudyDate ?? null,
          summary.modality,
          summary.seriesCount,
          summary.instanceCount,
          ohifUrl,
          importedAt
        )

        const row = db.prepare(`
          SELECT *
          FROM dicom_study_links
          WHERE student_id = ? AND module_code = ? AND station_number = ? AND study_instance_uid = ?
        `).get(student.student_id, parsed.module_code, parsed.station_number, studyInstanceUid)
        importedLinks.push(rowToStudyLink(row))
      } catch (err) {
        errors++
        unresolvedItems.push(
          insertUnresolved(db, runId, studyId, null, null, `Failed to inspect study: ${String(err)}`, null)
        )
      }
    }
  } catch (err) {
    errors++
    unresolvedItems.push(
      insertUnresolved(db, runId, null, null, null, `Failed to list Orthanc studies: ${String(err)}`, null)
    )
  }

  db.prepare(`
    UPDATE dicom_import_runs
    SET studies_scanned = ?, matched = ?, unresolved = ?, errors = ?
    WHERE id = ?
  `).run(studiesScanned, importedLinks.length, unresolvedItems.length, errors, runId)

  return {
    run_id: runId,
    studies_scanned: studiesScanned,
    matched: importedLinks.length,
    unresolved: unresolvedItems.length,
    errors,
    links: importedLinks,
    unresolved_items: unresolvedItems
  }
}
