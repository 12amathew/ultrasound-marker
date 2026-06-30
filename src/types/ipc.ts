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

export interface CsvStudentPreviewRow {
  row: number
  student_id: string
  full_name: string
  module_codes: string[]
  data: string
}

export interface CsvStudentPreviewResult {
  rows: CsvStudentPreviewRow[]
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
  candidate_instructions?: string | null
  form_fields?: StationFormField[]
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

export interface AssessmentProfile {
  id: string
  name: string
  is_active: number
  admin_pin_salt: string | null
  admin_pin_hash: string | null
  created_at: string
  updated_at: string
}

export interface StationFormField {
  field_id: string
  label: string
  field_type: 'score' | 'text'
  min_score: number | null
  max_score: number | null
  tolerance: number
  required: boolean
  sort_order: number
}

export interface ProfileStation {
  module_code: string
  station_number: number
  label: string
  candidate_instructions: string | null
  form_fields: StationFormField[]
}

export interface DicomStationMapping {
  source_station_number: number
  target_station_number: number
}

export interface ProfileModule {
  code: string
  name: string
  aliases: string[]
  stations: ProfileStation[]
  dicom_station_mappings: DicomStationMapping[]
}

export interface ProfileConfig {
  profile: AssessmentProfile
  modules: ProfileModule[]
  examiners: { name: string; is_admin: boolean; module_codes: string[] | null }[]
  students: { student_id: string; full_name: string; module_codes: string[] }[]
}

export interface FieldResponseInput {
  field_id: string
  field_type: 'score' | 'text'
  value_num?: number | null
  value_text?: string | null
}

export interface ExaminerFormMarkDetail {
  examiner_name: string
  marked_at: string
  station_score: number | null
  station_max_score: number
  responses: FieldResponseInput[]
}

export interface StudentImages {
  img1Path: string | null
  img2Path: string | null
  conclusionPath: string | null
}

export interface ReferenceDicomLink {
  profile_id: string
  module_code: string
  station_number: number
  slot: 1 | 2
  patient_id: string
  study_instance_uid: string
  orthanc_study_id: string
  study_description: string | null
  study_date: string | null
  modality: string | null
  series_count: number
  instance_count: number
  ohif_url: string
  linked_at: string
  preview_count: number | null
  preview_error: string | null
  preview_checked_at: string | null
}

export interface ReferenceImages {
  img1Path: string | null
  img2Path: string | null
  img1DicomLink: ReferenceDicomLink | null
  img2DicomLink: ReferenceDicomLink | null
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

export type UpdateStatusKind =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'
  | 'unsupported'

export interface AppUpdateStatus {
  status: UpdateStatusKind
  currentVersion: string
  source?: 'automatic' | 'manual'
  availableVersion?: string
  percent?: number
  message?: string
  checkedAt?: string
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
  dicom_links: DicomStudyLink[]
  active_dicom_link: DicomStudyLink | null
}

export interface DicomServerConfig {
  orthanc_base_url: string
  ohif_base_url: string
}

export interface DicomParsedPatientId {
  student_short_id: string
  module_code: string
  source_station_number: number
  station_number: number
}

export interface DicomStudyLink {
  id: number
  student_id: string
  student_short_id: string
  module_code: string
  station_number: number
  patient_id: string
  study_instance_uid: string
  orthanc_study_id: string
  study_description: string | null
  study_date: string | null
  modality: string | null
  series_count: number
  instance_count: number
  ohif_url: string
  imported_at: string
  preview_count: number | null
  preview_error: string | null
  preview_checked_at: string | null
}

export interface DicomStudyPreview {
  dataUrl: string | null
  orthanc_study_id: string
  orthanc_instance_id: string | null
  orthanc_frame_index?: number | null
  content_type: string | null
  image_index: number
  error?: string
}

export interface DicomStudyPreviews {
  orthanc_study_id: string
  previews: DicomStudyPreview[]
  error?: string
}

export interface DicomUnresolvedStudy {
  id: number
  run_id: number | null
  orthanc_study_id: string | null
  patient_id: string | null
  study_instance_uid: string | null
  reason: string
  raw_metadata: string | null
  seen_at: string
  preview_count?: number | null
  preview_error?: string | null
  preview_checked_at?: string | null
}

export interface DicomUnresolvedStudyDetails {
  unresolved: DicomUnresolvedStudy
  previews: DicomStudyPreview[]
  error?: string
  study_description: string | null
  study_date: string | null
  modality: string | null
  series_count: number | null
  instance_count: number | null
}

export interface DicomStudyCandidate {
  orthanc_study_id: string
  patient_id: string | null
  study_instance_uid: string | null
  study_description: string | null
  study_date: string | null
  modality: string | null
  series_count: number | null
  instance_count: number | null
  current_link: DicomStudyLink | null
  unresolved: DicomUnresolvedStudy | null
}

export interface DicomStudyCandidateDetails extends DicomStudyCandidate {
  previews: DicomStudyPreview[]
  error?: string
}

export interface DicomManualLinkResult {
  success: boolean
  link?: DicomStudyLink
  error?: string
}

export interface ReferenceDicomLinkResult {
  success: boolean
  link?: ReferenceDicomLink
  error?: string
}

export interface DicomUnlinkResult {
  success: boolean
  restored_unresolved?: DicomUnresolvedStudy
  error?: string
}

export interface DicomSyncResult {
  run_id: number
  studies_scanned: number
  matched: number
  unresolved: number
  errors: number
  links: DicomStudyLink[]
  reference_links: ReferenceDicomLink[]
  unresolved_items: DicomUnresolvedStudy[]
}

export interface DicomUploadItem {
  path: string
  status: 'uploaded' | 'skipped' | 'error'
  reason?: string
}

export interface DicomUploadResult {
  scanned: number
  uploaded: number
  skipped: number
  errors: number
  items: DicomUploadItem[]
}

export interface DicomPreparedExportGroup {
  key: string
  group_type: 'station' | 'reference'
  folder_path: string
  status: 'valid' | 'invalid'
  reason?: string
  student_id?: string
  full_name?: string
  student_short_id: string
  module_code: string
  source_station_number: number
  station_number: number
  patient_id: string
  file_count: number
  image_count: number
  dicom_count: number
  unsupported_count: number
  warnings: string[]
  planned_action: string
}

export interface DicomPreparedExportResult {
  root_path: string
  scanned_groups: number
  valid_groups: number
  invalid_groups: number
  groups: DicomPreparedExportGroup[]
}

export interface DicomPreparedUploadItem {
  group_key: string
  path?: string
  status: 'uploaded' | 'skipped' | 'error'
  reason?: string
}

export interface DicomPreparedUploadResult {
  prepared: DicomPreparedExportResult
  scanned: number
  uploaded: number
  skipped: number
  errors: number
  items: DicomPreparedUploadItem[]
  sync_result: DicomSyncResult
}

// Re-export for convenience
export type { MarkingState, FileSortLogEntry }
