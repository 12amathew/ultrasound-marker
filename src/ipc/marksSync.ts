import { writeFileSync, readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import {
  getActiveProfileId,
  getMarkingState,
  saveExaminerFormResponses,
  type FieldResponseInput
} from '../db/queries'
import type { ImportResult } from '../types/ipc'

const FORMAT_VERSION = 2

interface ExportedResponseRow {
  student_id: string
  module_code: string
  station_number: number
  examiner_name: string
  field_id: string
  field_type: 'score' | 'text'
  value_num: number | null
  value_text: string | null
  marked_at: string
}

interface ExportedDynamicMarks {
  format_version: number
  profile_id: string
  exported_at: string
  responses: ExportedResponseRow[]
}

export function exportMarks(db: Database.Database, destPath: string): void {
  const profileId = getActiveProfileId(db)
  const responses = db
    .prepare(
      `SELECT student_id, module_code, station_number, examiner_name, field_id,
              field_type, value_num, value_text, marked_at
       FROM examiner_form_responses
       WHERE profile_id = ?
       ORDER BY module_code, station_number, student_id, examiner_name, field_id`
    )
    .all(profileId) as ExportedResponseRow[]

  const payload: ExportedDynamicMarks = {
    format_version: FORMAT_VERSION,
    profile_id: profileId,
    exported_at: new Date().toISOString(),
    responses
  }

  writeFileSync(destPath, JSON.stringify(payload, null, 2), 'utf-8')
}

export function importMarks(
  db: Database.Database,
  srcPath: string
): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(srcPath, 'utf-8'))
  } catch {
    return { imported: 0, skipped: 0, agreements: 0, disagreements: 0, error: 'Could not read or parse the file.' }
  }

  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as ExportedDynamicMarks).format_version !== FORMAT_VERSION ||
    !Array.isArray((raw as ExportedDynamicMarks).responses)
  ) {
    return { imported: 0, skipped: 0, agreements: 0, disagreements: 0, error: 'File does not appear to be a valid dynamic marks export.' }
  }

  const payload = raw as ExportedDynamicMarks
  const profileId = getActiveProfileId(db)
  if (payload.profile_id !== profileId) {
    return {
      imported: 0,
      skipped: payload.responses.length,
      agreements: 0,
      disagreements: 0,
      error: 'Marks export belongs to a different assessment profile.'
    }
  }

  const knownStudents = new Set(
    (db.prepare('SELECT student_id || \'|\' || module_code AS key FROM student_enrollments WHERE profile_id = ?').all(profileId) as { key: string }[])
      .map((r) => r.key)
  )

  const groups = new Map<string, ExportedResponseRow[]>()
  let skipped = 0
  for (const response of payload.responses) {
    if (!knownStudents.has(`${response.student_id}|${response.module_code}`)) {
      skipped++
      continue
    }
    const key = [
      response.student_id,
      response.module_code,
      response.station_number,
      response.examiner_name
    ].join('|')
    groups.set(key, [...(groups.get(key) ?? []), response])
  }

  let imported = 0
  let agreements = 0
  let disagreements = 0

  for (const rows of groups.values()) {
    const first = rows[0]
    const exists = db
      .prepare(
        `SELECT 1 FROM examiner_form_responses
         WHERE profile_id = ? AND student_id = ? AND module_code = ?
           AND station_number = ? AND examiner_name = ?
         LIMIT 1`
      )
      .get(profileId, first.student_id, first.module_code, first.station_number, first.examiner_name)
    if (exists) {
      skipped += rows.length
      continue
    }

    const responses: FieldResponseInput[] = rows.map((row) => ({
      field_id: row.field_id,
      field_type: row.field_type,
      value_num: row.value_num,
      value_text: row.value_text
    }))
    saveExaminerFormResponses(
      db,
      first.student_id,
      first.module_code,
      first.station_number,
      first.examiner_name,
      responses
    )
    imported += rows.length
    const state = getMarkingState(db, first.student_id, first.module_code, first.station_number)
    if (state === 'AGREED') agreements++
    else if (state === 'DISAGREEMENT') disagreements++
  }

  return { imported, skipped, agreements, disagreements }
}
