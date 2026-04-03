import { writeFileSync, readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import { importExaminerMark, getMarkingState } from '../db/queries'
import type { ExportedMarks, ImportResult, ExportedMarkRow } from '../types/ipc'

const FORMAT_VERSION = 1

interface StationConfig {
  number: number
  has_conclusion: boolean
}

interface ModuleConfig {
  code: string
  stations: StationConfig[]
}

export function exportMarks(db: Database.Database, destPath: string): void {
  const marks = db
    .prepare(
      `SELECT student_id, module_code, station_number, examiner_name,
              img1_mark, img2_mark, conclusion_mark, station_score, marked_at
       FROM examiner_marks
       ORDER BY module_code, station_number, student_id`
    )
    .all() as ExportedMarkRow[]

  const payload: ExportedMarks = {
    format_version: FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    marks
  }

  writeFileSync(destPath, JSON.stringify(payload, null, 2), 'utf-8')
}

export function importMarks(
  db: Database.Database,
  srcPath: string,
  modulesConfig: ModuleConfig[]
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
    (raw as ExportedMarks).format_version !== FORMAT_VERSION ||
    !Array.isArray((raw as ExportedMarks).marks)
  ) {
    return { imported: 0, skipped: 0, agreements: 0, disagreements: 0, error: 'File does not appear to be a valid marks export.' }
  }

  const payload = raw as ExportedMarks

  // Build a lookup for has_conclusion
  const conclusionMap = new Map<string, boolean>()
  for (const mod of modulesConfig) {
    for (const st of mod.stations) {
      conclusionMap.set(`${mod.code}|${st.number}`, st.has_conclusion)
    }
  }

  // Verify the student register matches — warn if any student IDs are unknown
  const knownStudents = new Set(
    (db.prepare('SELECT student_id || \'|\' || module_code AS key FROM students').all() as { key: string }[])
      .map((r) => r.key)
  )

  let imported = 0
  let skipped = 0
  let agreements = 0
  let disagreements = 0
  const unknownStudents = new Set<string>()

  for (const mark of payload.marks) {
    if (
      typeof mark.student_id !== 'string' ||
      typeof mark.module_code !== 'string' ||
      typeof mark.station_number !== 'number' ||
      typeof mark.examiner_name !== 'string'
    ) {
      skipped++
      continue
    }

    // Skip if student not in this DB's register
    if (!knownStudents.has(`${mark.student_id}|${mark.module_code}`)) {
      unknownStudents.add(`${mark.student_id} (${mark.module_code})`)
      skipped++
      continue
    }

    const has_conclusion = conclusionMap.get(`${mark.module_code}|${mark.station_number}`) ?? false

    const outcome = importExaminerMark(
      db,
      mark.student_id,
      mark.module_code,
      mark.station_number,
      mark.examiner_name,
      mark.img1_mark,
      mark.img2_mark,
      mark.conclusion_mark,
      mark.station_score,
      mark.marked_at,
      has_conclusion
    )

    if (outcome === 'skipped') {
      skipped++
    } else {
      imported++
      const state = getMarkingState(db, mark.student_id, mark.module_code, mark.station_number)
      if (state === 'AGREED') agreements++
      else if (state === 'DISAGREEMENT') disagreements++
    }
  }

  const warning =
    unknownStudents.size > 0
      ? `${unknownStudents.size} student(s) in the import file were not found in this database and were skipped.`
      : undefined

  return { imported, skipped, agreements, disagreements, warning }
}
