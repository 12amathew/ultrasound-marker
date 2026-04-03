export type ModuleCode = 'AS' | 'FC' | 'NB' | 'HD' | 'LM' | 'PR'

export interface StationConfig {
  number: number
  label: string
  has_conclusion: boolean
  conclusion_reference_text: string | null
}

export interface ModuleConfig {
  code: ModuleCode
  name: string
  stations: StationConfig[]
}

export interface StationsConfig {
  modules: ModuleConfig[]
}

export type MarkingState = 'UNMARKED' | 'FIRST_MARK' | 'AGREED' | 'DISAGREEMENT' | 'RESOLVED'

export interface Student {
  id: number
  student_id: string
  full_name: string
  module_code: string
}

export interface ExaminerMark {
  id: number
  student_id: string
  module_code: string
  station_number: number
  examiner_name: string
  img1_mark: number | null
  img2_mark: number | null
  conclusion_mark: number | null
  station_score: number | null
  marked_at: string
}

export interface ResolvedMark {
  id: number
  student_id: string
  module_code: string
  station_number: number
  img1_mark: number
  img2_mark: number
  conclusion_mark: number | null
  station_score: number
  resolution_type: 'agreed' | 'resolved'
  resolved_by: string | null
  resolved_at: string
}

export interface FileSortLogEntry {
  id: number
  run_at: string
  source_path: string
  dest_path: string | null
  status: 'success' | 'unresolved' | 'error'
  reason: string | null
}
