import { readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import { resolveModuleAlias, upsertStudent } from '../db/queries'
import type { CsvImportResult, CsvStudentPreviewResult, CsvStudentPreviewRow } from '../types/ipc'

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && quoted && next === '"') {
      current += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cols.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  cols.push(current.trim())
  return cols
}

export function previewStudentCsv(db: Database.Database, filePath: string): CsvStudentPreviewResult {
  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    return { rows: [], skipped: 0, errors: [{ row: 0, reason: 'File is empty or has no data rows', data: '' }] }
  }

  // Parse header — case-insensitive column matching
  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase())
  const col = (name: string): number => headers.indexOf(name)

  const iFullName = col('full_name')
  const iStudentId = col('student_id')
  const iModuleCode1 = col('module_code_1')
  const iModuleCode2 = col('module_code_2')

  if (iFullName === -1 || iStudentId === -1 || iModuleCode1 === -1) {
    return {
      rows: [],
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

  let skipped = 0
  const errors: CsvStudentPreviewResult['errors'] = []
  const rows: CsvStudentPreviewRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1 // 1-based, including header
    const raw_line = lines[i]

    const cols = parseCsvLine(raw_line)

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

    const moduleCodes: string[] = []

    if (module_code_1) {
      const resolvedModule1 = resolveModuleAlias(db, module_code_1)
      if (resolvedModule1 && !isExcluded(student_id, resolvedModule1)) {
        moduleCodes.push(resolvedModule1)
      }
    }

    if (module_code_2) {
      const resolvedModule2 = resolveModuleAlias(db, module_code_2)
      if (resolvedModule2 && !isExcluded(student_id, resolvedModule2)) {
        moduleCodes.push(resolvedModule2)
      }
    }

    const uniqueModuleCodes = [...new Set(moduleCodes)]
    if (uniqueModuleCodes.length === 0) {
      skipped++
      continue
    }

    rows.push({
      row: rowNum,
      student_id,
      full_name,
      module_codes: uniqueModuleCodes,
      data: raw_line
    })
  }

  return { rows, skipped, errors }
}

export function importCsv(db: Database.Database, filePath: string): CsvImportResult {
  const preview = previewStudentCsv(db, filePath)
  let imported = 0

  for (const row of preview.rows) {
    for (const moduleCode of row.module_codes) {
      upsertStudent(db, row.student_id, row.full_name, moduleCode)
      imported++
    }
  }

  return { imported, skipped: preview.skipped, errors: preview.errors }
}
