import { readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import { upsertStudent } from '../db/queries'
import type { CsvImportResult } from '../types/ipc'

const KNOWN_MODULE_CODES = new Set(['AS', 'FC', 'NB', 'HD', 'LM', 'PR'])

export function importCsv(db: Database.Database, filePath: string): CsvImportResult {
  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)

  if (lines.length < 2) {
    return { imported: 0, skipped: 0, errors: [{ row: 0, reason: 'File is empty or has no data rows', data: '' }] }
  }

  // Parse header — case-insensitive column matching
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const col = (name: string): number => headers.indexOf(name)

  const iFullName = col('full_name')
  const iStudentId = col('student_id')
  const iModuleCode1 = col('module_code_1')
  const iModuleCode2 = col('module_code_2')

  if (iFullName === -1 || iStudentId === -1 || iModuleCode1 === -1) {
    return {
      imported: 0,
      skipped: 0,
      errors: [{ row: 0, reason: 'Missing required columns: full_name, student_id, module_code_1', data: lines[0] }]
    }
  }

  // Pre-load all excluded enrollments into a Set for fast lookup
  const excludedRows = db
    .prepare('SELECT student_id, module_code FROM excluded_enrollments')
    .all() as { student_id: string; module_code: string }[]
  const excluded = new Set(excludedRows.map((r) => `${r.student_id}:${r.module_code}`))

  const isExcluded = (sid: string, mod: string): boolean => excluded.has(`${sid}:${mod}`)

  let imported = 0
  let skipped = 0
  const errors: CsvImportResult['errors'] = []

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1 // 1-based, including header
    const raw_line = lines[i]

    // Split respecting basic CSV (no quoted fields with commas needed here)
    const cols = raw_line.split(',').map((c) => c.trim())

    const full_name = cols[iFullName] ?? ''
    const student_id_raw = cols[iStudentId] ?? ''
    // Strip any non-digit characters (handles invisible chars from Windows/ultrasound exports)
    const student_id = student_id_raw.trim().replace(/\D/g, '')
    const module_code_1 = (cols[iModuleCode1] ?? '').trim().toUpperCase()
    const module_code_2 = iModuleCode2 !== -1 ? (cols[iModuleCode2] ?? '').trim().toUpperCase() : ''

    // Validate student_id — must be exactly 9 digits
    if (!/^\d{9}$/.test(student_id)) {
      errors.push({ row: rowNum, reason: `Invalid student_id "${student_id_raw}" — must be exactly 9 digits`, data: raw_line })
      skipped++
      continue
    }

    if (!full_name) {
      errors.push({ row: rowNum, reason: 'Missing full_name', data: raw_line })
      skipped++
      continue
    }

    // Process module_code_1
    if (module_code_1) {
      if (!KNOWN_MODULE_CODES.has(module_code_1)) {
        // Unknown module code — out of scope, skip silently (not an error per user instruction)
        skipped++
      } else if (isExcluded(student_id, module_code_1)) {
        skipped++
      } else {
        upsertStudent(db, student_id, full_name, module_code_1)
        imported++
      }
    }

    // Process module_code_2 (optional)
    if (module_code_2) {
      if (!KNOWN_MODULE_CODES.has(module_code_2)) {
        // Out-of-scope module, skip
      } else if (!isExcluded(student_id, module_code_2)) {
        upsertStudent(db, student_id, full_name, module_code_2)
        imported++
      }
    }
  }

  return { imported, skipped, errors }
}
