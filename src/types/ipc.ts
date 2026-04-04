import type { MarkingState, FileSortLogEntry } from './index'

// ── Shared result shapes ─────────────────────────────────────────────────────

export interface StudentRow {
  student_id: string
  full_name: string
  module_code: string
}

export interface CsvImportResult {
  imported: number
  skipped: number
  errors: { row: number; reason: string; data: string }[]
}

export interface FileSortResult {
  processed: number
  placed: number
  unresolved: { source: string; reason: string }[]
}

export interface StationProgress {
  station_number: number
  label: string
  marked_by_me: number
  resolved: number
  total: number
  awaiting_second: number
  needs_resolution: number
}

export interface ModuleProgress {
  module_code: string
  module_name: string
  total_students: number
  stations: StationProgress[]
}

export interface StudentImages {
  img1Path: string | null
  img2Path: string | null
  conclusionPath: string | null
}

export interface ReferenceImages {
  img1Path: string | null
  img2Path: string | null
}

export interface ExaminerMarkDetail {
  examiner_name: string
  img1_mark: number | null
  img2_mark: number | null
  conclusion_mark: number | null
  station_score: number | null
  marked_at: string
}

export interface DisagreementRow {
  student_id: string
  full_name: string
}

export interface ExportedMarkRow {
  student_id: string
  module_code: string
  station_number: number
  examiner_name: string
  img1_mark: number
  img2_mark: number
  conclusion_mark: number | null
  station_score: number
  marked_at: string
}

export interface ExportedMarks {
  format_version: number
  exported_at: string
  marks: ExportedMarkRow[]
}

export interface ImportResult {
  imported: number
  skipped: number
  agreements: number
  disagreements: number
  error?: string
  warning?: string
}

export interface AuditEntry {
  student_id: string
  full_name: string
  module_code: string
  station_number: number
  station_dir: string
  dir_exists: boolean
  img1: string | null
  img2: string | null
  conclusion: string | null
  requires_conclusion: boolean
}

// Re-export for convenience
export type { MarkingState, FileSortLogEntry }
