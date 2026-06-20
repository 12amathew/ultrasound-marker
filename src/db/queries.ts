import type Database from 'better-sqlite3'
import type { MarkingState } from '../types'

const LEGACY_PROFILE_ID = 'legacy-assessment'

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

export interface ProfileModule {
  code: string
  name: string
  aliases: string[]
  stations: ProfileStation[]
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

function nowIso(): string {
  return new Date().toISOString()
}

export function getActiveProfileId(db: Database.Database): string {
  const row = db
    .prepare('SELECT id FROM assessment_profiles WHERE is_active = 1 LIMIT 1')
    .get() as { id: string } | undefined
  return row?.id ?? LEGACY_PROFILE_ID
}

export function getActiveProfile(db: Database.Database): AssessmentProfile | null {
  return (
    (db.prepare('SELECT * FROM assessment_profiles WHERE id = ?').get(getActiveProfileId(db)) as AssessmentProfile | undefined) ??
    null
  )
}

export function listAssessmentProfiles(db: Database.Database): AssessmentProfile[] {
  return db
    .prepare('SELECT * FROM assessment_profiles ORDER BY is_active DESC, updated_at DESC, name')
    .all() as AssessmentProfile[]
}

export function createAssessmentProfile(db: Database.Database, name: string): AssessmentProfile {
  const id = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const ts = nowIso()
  db.prepare(`
    INSERT INTO assessment_profiles (id, name, is_active, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?)
  `).run(id, name.trim() || 'Untitled assessment', ts, ts)
  return db.prepare('SELECT * FROM assessment_profiles WHERE id = ?').get(id) as AssessmentProfile
}

export function setActiveAssessmentProfile(db: Database.Database, profileId: string): void {
  db.prepare('UPDATE assessment_profiles SET is_active = 0').run()
  db.prepare('UPDATE assessment_profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(nowIso(), profileId)
}

export function getProfileModules(db: Database.Database, profileId = getActiveProfileId(db)): ProfileModule[] {
  const modules = db
    .prepare(
      `SELECT code, name FROM assessment_modules
       WHERE profile_id = ?
       ORDER BY sort_order, code`
    )
    .all(profileId) as { code: string; name: string }[]

  const aliases = db
    .prepare('SELECT module_code, alias FROM assessment_module_aliases WHERE profile_id = ? ORDER BY alias')
    .all(profileId) as { module_code: string; alias: string }[]
  const aliasMap = new Map<string, string[]>()
  for (const row of aliases) {
    aliasMap.set(row.module_code, [...(aliasMap.get(row.module_code) ?? []), row.alias])
  }

  const stations = db
    .prepare(
      `SELECT module_code, station_number, label, candidate_instructions
       FROM assessment_stations
       WHERE profile_id = ?
       ORDER BY sort_order, station_number`
    )
    .all(profileId) as Omit<ProfileStation, 'form_fields'>[]
  const stationMap = new Map<string, ProfileStation[]>()
  for (const station of stations) {
    const key = station.module_code
    stationMap.set(key, [...(stationMap.get(key) ?? []), { ...station, form_fields: [] }])
  }

  const fields = db
    .prepare(
      `SELECT module_code, station_number, field_id, label, field_type, max_score, tolerance, required, sort_order
       FROM station_form_fields
       WHERE profile_id = ?
       ORDER BY sort_order, id`
    )
    .all(profileId) as Array<StationFormField & { module_code: string; station_number: number; required: number }>
  for (const field of fields) {
    const list = stationMap.get(field.module_code) ?? []
    const station = list.find((s) => s.station_number === field.station_number)
    if (station) {
      station.form_fields.push({
        field_id: field.field_id,
        label: field.label,
        field_type: field.field_type,
        max_score: field.max_score,
        tolerance: field.tolerance,
        required: Boolean(field.required),
        sort_order: field.sort_order
      })
    }
  }

  return modules.map((mod) => ({
    ...mod,
    aliases: aliasMap.get(mod.code) ?? [mod.code],
    stations: stationMap.get(mod.code) ?? []
  }))
}

export function getActiveProfileConfig(db: Database.Database): ProfileConfig | null {
  const profile = getActiveProfile(db)
  if (!profile) return null
  const modules = getProfileModules(db, profile.id)
  const assignments = db
    .prepare('SELECT examiner_name, module_code FROM examiner_module_assignments WHERE profile_id = ?')
    .all(profile.id) as { examiner_name: string; module_code: string }[]
  const assignmentMap = new Map<string, string[]>()
  for (const row of assignments) {
    assignmentMap.set(row.examiner_name, [...(assignmentMap.get(row.examiner_name) ?? []), row.module_code])
  }
  const examiners = (
    db
      .prepare('SELECT name, is_admin FROM assessment_examiners WHERE profile_id = ? ORDER BY sort_order, name')
      .all(profile.id) as { name: string; is_admin: number }[]
  ).map((row) => ({
    name: row.name,
    is_admin: Boolean(row.is_admin),
    module_codes: assignmentMap.get(row.name) ?? null
  }))
  const enrollmentRows = db
    .prepare(
      `SELECT ps.student_id, ps.full_name, se.module_code
       FROM profile_students ps
       LEFT JOIN student_enrollments se
        ON se.profile_id = ps.profile_id AND se.student_id = ps.student_id
       WHERE ps.profile_id = ?
       ORDER BY ps.full_name, se.module_code`
    )
    .all(profile.id) as { student_id: string; full_name: string; module_code: string | null }[]
  const studentMap = new Map<string, { student_id: string; full_name: string; module_codes: string[] }>()
  for (const row of enrollmentRows) {
    if (!studentMap.has(row.student_id)) {
      studentMap.set(row.student_id, { student_id: row.student_id, full_name: row.full_name, module_codes: [] })
    }
    if (row.module_code) studentMap.get(row.student_id)!.module_codes.push(row.module_code)
  }
  return { profile, modules, examiners, students: [...studentMap.values()] }
}

export function resolveModuleAlias(
  db: Database.Database,
  moduleOrAlias: string,
  profileId = getActiveProfileId(db)
): string | null {
  const clean = moduleOrAlias.trim().toUpperCase()
  const row = db
    .prepare('SELECT module_code FROM assessment_module_aliases WHERE profile_id = ? AND upper(alias) = ?')
    .get(profileId, clean) as { module_code: string } | undefined
  if (row) return row.module_code
  const mod = db
    .prepare('SELECT code FROM assessment_modules WHERE profile_id = ? AND upper(code) = ?')
    .get(profileId, clean) as { code: string } | undefined
  return mod?.code ?? null
}

// ─── Scoring ────────────────────────────────────────────────────────────────

export function calcStationScore(
  img1: number | null,
  img2: number | null,
  conclusion: number | null
): number | null {
  if (img1 === null || img2 === null) return null
  if (conclusion === null) {
    return img1 + img2
  }
  return Math.round(((img1 + img2 + conclusion) / 3) * 2 * 100) / 100
}

// ─── Students ───────────────────────────────────────────────────────────────

export function upsertStudent(
  db: Database.Database,
  student_id: string,
  full_name: string,
  module_code: string
): void {
  const profileId = getActiveProfileId(db)
  const resolvedModuleCode = resolveModuleAlias(db, module_code, profileId) ?? module_code
  const ts = nowIso()
  db.prepare(`
    INSERT INTO students (student_id, full_name, module_code)
    VALUES (?, ?, ?)
    ON CONFLICT(student_id, module_code) DO UPDATE SET full_name = excluded.full_name
  `).run(student_id, full_name, resolvedModuleCode)
  db.prepare(`
    INSERT INTO profile_students (profile_id, student_id, full_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, student_id) DO UPDATE SET
      full_name = excluded.full_name,
      updated_at = excluded.updated_at
  `).run(profileId, student_id, full_name, ts, ts)
  db.prepare(`
    INSERT OR IGNORE INTO student_enrollments (profile_id, student_id, module_code, created_at)
    VALUES (?, ?, ?, ?)
  `).run(profileId, student_id, resolvedModuleCode, ts)
}

export function getStudentsByModule(
  db: Database.Database,
  module_code: string
): { student_id: string; full_name: string; module_code: string }[] {
  const profileId = getActiveProfileId(db)
  return db
    .prepare(
      `SELECT ps.student_id, ps.full_name, se.module_code
       FROM profile_students ps
       JOIN student_enrollments se
        ON se.profile_id = ps.profile_id AND se.student_id = ps.student_id
       WHERE ps.profile_id = ? AND se.module_code = ?
       ORDER BY ps.full_name`
    )
    .all(profileId, module_code) as { student_id: string; full_name: string; module_code: string }[]
}

export function getStudentByShortId(
  db: Database.Database,
  short_id: string,
  module_code: string
): { student_id: string; full_name: string } | null {
  const profileId = getActiveProfileId(db)
  const resolvedModuleCode = resolveModuleAlias(db, module_code, profileId)
  if (!resolvedModuleCode) return null
  return (
    (db
      .prepare(
        `SELECT ps.student_id, ps.full_name
         FROM profile_students ps
         JOIN student_enrollments se
          ON se.profile_id = ps.profile_id AND se.student_id = ps.student_id
         WHERE ps.profile_id = ? AND se.module_code = ? AND substr(ps.student_id, -6) = ?`
      )
      .get(profileId, resolvedModuleCode, short_id) as { student_id: string; full_name: string } | undefined) ?? null
  )
}

/** Find a student by short ID across all modules. Returns all matches. */
export function getStudentByShortIdAnyModule(
  db: Database.Database,
  short_id: string
): { student_id: string; full_name: string; module_code: string }[] {
  const profileId = getActiveProfileId(db)
  return db
    .prepare(
      `SELECT ps.student_id, ps.full_name, se.module_code
       FROM profile_students ps
       JOIN student_enrollments se
        ON se.profile_id = ps.profile_id AND se.student_id = ps.student_id
       WHERE ps.profile_id = ? AND substr(ps.student_id, -6) = ?`
    )
    .all(profileId, short_id) as { student_id: string; full_name: string; module_code: string }[]
}

// ─── Marking State ───────────────────────────────────────────────────────────

export function getMarkingState(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number
): MarkingState {
  const profileId = getActiveProfileId(db)
  const row = db
    .prepare(
      'SELECT state FROM profile_marking_state WHERE profile_id=? AND student_id=? AND module_code=? AND station_number=?'
    )
    .get(profileId, student_id, module_code, station_number) as { state: MarkingState } | undefined
  return row?.state ?? 'UNMARKED'
}

export function setMarkingState(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  state: MarkingState
): void {
  const profileId = getActiveProfileId(db)
  db.prepare(`
    INSERT INTO profile_marking_state (profile_id, student_id, module_code, station_number, state, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, student_id, module_code, station_number)
    DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `).run(profileId, student_id, module_code, station_number, state, new Date().toISOString())
}

// ─── Examiner Marks ──────────────────────────────────────────────────────────

export function saveExaminerMark(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  examiner_name: string,
  img1_mark: number | null,
  img2_mark: number | null,
  conclusion_mark: number | null,
  has_conclusion: boolean
): void {
  const station_score = calcStationScore(img1_mark, img2_mark, has_conclusion ? conclusion_mark : null)
  const marked_at = new Date().toISOString()

  db.prepare(`
    INSERT INTO examiner_marks
      (student_id, module_code, station_number, examiner_name, img1_mark, img2_mark, conclusion_mark, station_score, marked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, module_code, station_number, examiner_name)
    DO UPDATE SET img1_mark = excluded.img1_mark,
                  img2_mark = excluded.img2_mark,
                  conclusion_mark = excluded.conclusion_mark,
                  station_score = excluded.station_score,
                  marked_at = excluded.marked_at
  `).run(
    student_id, module_code, station_number, examiner_name,
    img1_mark, img2_mark, conclusion_mark, station_score, marked_at
  )

  // Check how many marks now exist for this student/station
  const marks = db
    .prepare(
      `SELECT * FROM examiner_marks
       WHERE student_id=? AND module_code=? AND station_number=?
       ORDER BY marked_at ASC`
    )
    .all(student_id, module_code, station_number) as Array<{
      img1_mark: number | null; img2_mark: number | null; conclusion_mark: number | null
      station_score: number | null; examiner_name: string
    }>

  if (marks.length === 1) {
    setMarkingState(db, student_id, module_code, station_number, 'FIRST_MARK')
  } else if (marks.length === 2) {
    // Only run agreement detection when both examiners have complete marks
    const bothComplete = marks.every(
      (m) => m.img1_mark !== null && m.img2_mark !== null
    )
    if (bothComplete) {
      runAgreementDetection(
        db, student_id, module_code, station_number,
        marks[0] as { img1_mark: number; img2_mark: number; conclusion_mark: number | null },
        marks[1] as { img1_mark: number; img2_mark: number; conclusion_mark: number | null },
        has_conclusion
      )
    }
  }
}

export interface ExaminerMarkDetail {
  examiner_name: string
  img1_mark: number | null
  img2_mark: number | null
  conclusion_mark: number | null
  station_score: number | null
  marked_at: string
}

export function getExaminerMarksForStation(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number
): ExaminerMarkDetail[] {
  return db
    .prepare(
      `SELECT examiner_name, img1_mark, img2_mark, conclusion_mark, station_score, marked_at
       FROM examiner_marks
       WHERE student_id=? AND module_code=? AND station_number=?
       ORDER BY marked_at ASC`
    )
    .all(student_id, module_code, station_number) as ExaminerMarkDetail[]
}

export function hasExaminerMarkedStation(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  examiner_name: string
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM examiner_marks
       WHERE student_id=? AND module_code=? AND station_number=?
       AND lower(examiner_name)=lower(?)`
    )
    .get(student_id, module_code, station_number, examiner_name)
  return row !== undefined
}

/**
 * Insert an examiner mark imported from another laptop.
 * Uses INSERT OR IGNORE so it never overwrites an existing mark.
 * Runs agreement detection if both examiners have now marked this station.
 * Returns 'inserted' or 'skipped'.
 */
export function importExaminerMark(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  examiner_name: string,
  img1_mark: number,
  img2_mark: number,
  conclusion_mark: number | null,
  station_score: number,
  marked_at: string,
  has_conclusion: boolean
): 'inserted' | 'skipped' {
  const result = db.prepare(`
    INSERT OR IGNORE INTO examiner_marks
      (student_id, module_code, station_number, examiner_name, img1_mark, img2_mark, conclusion_mark, station_score, marked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(student_id, module_code, station_number, examiner_name, img1_mark, img2_mark, conclusion_mark, station_score, marked_at)

  if (result.changes === 0) return 'skipped'

  const marks = db
    .prepare(
      `SELECT * FROM examiner_marks
       WHERE student_id=? AND module_code=? AND station_number=?
       ORDER BY marked_at ASC`
    )
    .all(student_id, module_code, station_number) as Array<{
      img1_mark: number; img2_mark: number; conclusion_mark: number | null
    }>

  if (marks.length === 1) {
    setMarkingState(db, student_id, module_code, station_number, 'FIRST_MARK')
  } else if (marks.length >= 2) {
    runAgreementDetection(db, student_id, module_code, station_number, marks[0], marks[1], has_conclusion)
  }

  return 'inserted'
}

// ─── Agreement Detection ─────────────────────────────────────────────────────

function runAgreementDetection(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  mark1: { img1_mark: number; img2_mark: number; conclusion_mark: number | null },
  mark2: { img1_mark: number; img2_mark: number; conclusion_mark: number | null },
  has_conclusion: boolean
): void {
  // Marks within 1 point of each other are treated as agreed.
  const img1Agrees = Math.abs(mark1.img1_mark - mark2.img1_mark) <= 1
  const img2Agrees = Math.abs(mark1.img2_mark - mark2.img2_mark) <= 1
  const conclusionAgrees =
    !has_conclusion ||
    (mark1.conclusion_mark !== null &&
      mark2.conclusion_mark !== null &&
      Math.abs(mark1.conclusion_mark - mark2.conclusion_mark) <= 1)

  if (img1Agrees && img2Agrees && conclusionAgrees) {
    // Use the average of the two marks rounded to the nearest integer.
    const img1 = Math.round((mark1.img1_mark + mark2.img1_mark) / 2)
    const img2 = Math.round((mark1.img2_mark + mark2.img2_mark) / 2)
    const conclusion =
      has_conclusion && mark1.conclusion_mark !== null && mark2.conclusion_mark !== null
        ? Math.round((mark1.conclusion_mark + mark2.conclusion_mark) / 2)
        : null

    const score = calcStationScore(img1, img2, has_conclusion ? conclusion : null)!
    db.prepare(`
      INSERT INTO resolved_marks
        (student_id, module_code, station_number, img1_mark, img2_mark, conclusion_mark, station_score, resolution_type, resolved_by, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'agreed', NULL, ?)
      ON CONFLICT(student_id, module_code, station_number) DO UPDATE SET
        img1_mark=excluded.img1_mark, img2_mark=excluded.img2_mark,
        conclusion_mark=excluded.conclusion_mark, station_score=excluded.station_score,
        resolution_type='agreed', resolved_by=NULL, resolved_at=excluded.resolved_at
    `).run(
      student_id, module_code, station_number,
      img1, img2, has_conclusion ? conclusion : null,
      score, new Date().toISOString()
    )
    setMarkingState(db, student_id, module_code, station_number, 'AGREED')
  } else {
    setMarkingState(db, student_id, module_code, station_number, 'DISAGREEMENT')
  }
}

// ─── Resolved Marks ──────────────────────────────────────────────────────────

export function saveConsensus(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  examiner_name: string,
  img1_mark: number,
  img2_mark: number,
  conclusion_mark: number | null,
  has_conclusion: boolean
): void {
  const score = calcStationScore(img1_mark, img2_mark, has_conclusion ? conclusion_mark : null)!
  db.prepare(`
    INSERT INTO resolved_marks
      (student_id, module_code, station_number, img1_mark, img2_mark, conclusion_mark, station_score, resolution_type, resolved_by, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved', ?, ?)
    ON CONFLICT(student_id, module_code, station_number) DO UPDATE SET
      img1_mark=excluded.img1_mark, img2_mark=excluded.img2_mark,
      conclusion_mark=excluded.conclusion_mark, station_score=excluded.station_score,
      resolution_type='resolved', resolved_by=excluded.resolved_by, resolved_at=excluded.resolved_at
  `).run(
    student_id, module_code, station_number,
    img1_mark, img2_mark, has_conclusion ? conclusion_mark : null,
    score, examiner_name, new Date().toISOString()
  )
  setMarkingState(db, student_id, module_code, station_number, 'RESOLVED')
}

export function getResolvedMark(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number
): { img1_mark: number; img2_mark: number; conclusion_mark: number | null; station_score: number; resolution_type: string } | null {
  return (
    db
      .prepare(
        `SELECT img1_mark, img2_mark, conclusion_mark, station_score, resolution_type
         FROM resolved_marks WHERE student_id=? AND module_code=? AND station_number=?`
      )
      .get(student_id, module_code, station_number) as {
        img1_mark: number; img2_mark: number; conclusion_mark: number | null
        station_score: number; resolution_type: string
      } | undefined
  ) ?? null
}

// ─── Locking ─────────────────────────────────────────────────────────────────

const LOCK_TIMEOUT_MS = 5 * 60 * 1000

export function acquireLock(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  examiner_name: string
): boolean {
  const profileId = getActiveProfileId(db)
  const now = new Date()
  const existing = db
    .prepare(
      'SELECT locked_by, locked_at FROM profile_marking_locks WHERE profile_id=? AND student_id=? AND module_code=? AND station_number=?'
    )
    .get(profileId, student_id, module_code, station_number) as { locked_by: string; locked_at: string } | undefined

  if (existing) {
    const age = now.getTime() - new Date(existing.locked_at).getTime()
    if (age < LOCK_TIMEOUT_MS) {
      // Active lock held by someone else
      return false
    }
    // Stale lock — overwrite
  }

  db.prepare(`
    INSERT INTO profile_marking_locks (profile_id, student_id, module_code, station_number, locked_by, locked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, student_id, module_code, station_number)
    DO UPDATE SET locked_by=excluded.locked_by, locked_at=excluded.locked_at
  `).run(profileId, student_id, module_code, station_number, examiner_name, now.toISOString())

  return true
}

export function releaseLock(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number
): void {
  const profileId = getActiveProfileId(db)
  db.prepare(
    'DELETE FROM profile_marking_locks WHERE profile_id=? AND student_id=? AND module_code=? AND station_number=?'
  ).run(profileId, student_id, module_code, station_number)
}

// ─── Dashboard Progress ──────────────────────────────────────────────────────

export interface StationProgress {
  module_code: string
  station_number: number
  total: number
  marked_by_me: number
  resolved: number
  awaiting_second: number
  needs_resolution: number
}

export function getStationProgress(
  db: Database.Database,
  module_code: string,
  station_number: number,
  examiner_name: string
): StationProgress {
  const profileId = getActiveProfileId(db)
  const total = (
    db.prepare('SELECT COUNT(*) as c FROM student_enrollments WHERE profile_id=? AND module_code=?').get(profileId, module_code) as { c: number }
  ).c

  const marked_by_me = (
    db.prepare(
      `SELECT COUNT(DISTINCT student_id) as c FROM examiner_form_responses
       WHERE profile_id=? AND module_code=? AND station_number=? AND lower(examiner_name)=lower(?)`
    ).get(profileId, module_code, station_number, examiner_name) as { c: number }
  ).c

  const stateRows = db
    .prepare(
      `SELECT state, COUNT(*) as c FROM profile_marking_state
       WHERE profile_id=? AND module_code=? AND station_number=?
       GROUP BY state`
    )
    .all(profileId, module_code, station_number) as { state: string; c: number }[]

  const byState: Record<string, number> = {}
  for (const row of stateRows) byState[row.state] = row.c

  return {
    module_code,
    station_number,
    total,
    marked_by_me,
    resolved: (byState['AGREED'] ?? 0) + (byState['RESOLVED'] ?? 0),
    awaiting_second: byState['FIRST_MARK'] ?? 0,
    needs_resolution: byState['DISAGREEMENT'] ?? 0
  }
}

// ─── Marking Queue ───────────────────────────────────────────────────────────

export function getNextStudentToMark(
  db: Database.Database,
  module_code: string,
  station_number: number,
  examiner_name: string,
  skipList: string[]
): { student_id: string; full_name: string } | null {
  const profileId = getActiveProfileId(db)
  const now = new Date()
  const lockCutoff = new Date(now.getTime() - LOCK_TIMEOUT_MS).toISOString()

  // Build exclusion list: already marked by this examiner + skip list
  const alreadyMarked = db
    .prepare(
      `SELECT DISTINCT student_id FROM examiner_form_responses
       WHERE profile_id=? AND module_code=? AND station_number=? AND lower(examiner_name)=lower(?)`
    )
    .all(profileId, module_code, station_number, examiner_name)
    .map((r: unknown) => (r as { student_id: string }).student_id)

  const excluded = [...new Set([...alreadyMarked, ...skipList])]

  // Locked students (active locks not by this examiner)
  const locked = db
    .prepare(
      `SELECT student_id FROM profile_marking_locks
       WHERE profile_id=? AND module_code=? AND station_number=?
       AND locked_at > ? AND lower(locked_by) != lower(?)`
    )
    .all(profileId, module_code, station_number, lockCutoff, examiner_name)
    .map((r: unknown) => (r as { student_id: string }).student_id)

  const allExcluded = [...new Set([...excluded, ...locked])]
  const hasExclusions = allExcluded.length > 0
  const placeholders = hasExclusions ? allExcluded.map(() => '?').join(',') : null

  // Try UNMARKED first, then FIRST_MARK
  for (const targetState of ['UNMARKED', 'FIRST_MARK']) {
    let query: string
    let params: unknown[]

    if (targetState === 'UNMARKED') {
      // Students who have no marking_state row yet, or explicitly UNMARKED
      query = `
        SELECT ps.student_id, ps.full_name
        FROM profile_students ps
        JOIN student_enrollments se
          ON se.profile_id=ps.profile_id AND se.student_id=ps.student_id
        LEFT JOIN profile_marking_state ms
          ON ms.profile_id=ps.profile_id AND ms.student_id=ps.student_id AND ms.module_code=se.module_code AND ms.station_number=?
        WHERE ps.profile_id=? AND se.module_code=?
          AND (ms.state IS NULL OR ms.state='UNMARKED')
          ${hasExclusions ? `AND ps.student_id NOT IN (${placeholders})` : ''}
        LIMIT 1
      `
      params = [station_number, profileId, module_code, ...allExcluded]
    } else {
      query = `
        SELECT ps.student_id, ps.full_name
        FROM profile_students ps
        JOIN student_enrollments se
          ON se.profile_id=ps.profile_id AND se.student_id=ps.student_id
        JOIN profile_marking_state ms
          ON ms.profile_id=ps.profile_id AND ms.student_id=ps.student_id AND ms.module_code=se.module_code AND ms.station_number=?
        WHERE ps.profile_id=? AND se.module_code=?
          AND ms.state='FIRST_MARK'
          ${hasExclusions ? `AND ps.student_id NOT IN (${placeholders})` : ''}
        LIMIT 1
      `
      params = [station_number, profileId, module_code, ...allExcluded]
    }

    const row = db.prepare(query).get(...params) as { student_id: string; full_name: string } | undefined
    if (row) return row
  }

  return null
}

// ─── Student list with marking state ────────────────────────────────────────

export function getStudentsWithState(
  db: Database.Database,
  module_code: string,
  station_number: number
): { student_id: string; full_name: string; state: string }[] {
  const profileId = getActiveProfileId(db)
  return db
    .prepare(
      `SELECT ps.student_id, ps.full_name,
              COALESCE(ms.state, 'UNMARKED') as state
       FROM profile_students ps
       JOIN student_enrollments se
         ON se.profile_id = ps.profile_id AND se.student_id = ps.student_id
       LEFT JOIN profile_marking_state ms
         ON ms.profile_id = ps.profile_id
         AND ms.student_id = ps.student_id
         AND ms.module_code = se.module_code
         AND ms.station_number = ?
       WHERE ps.profile_id = ? AND se.module_code = ?
       ORDER BY ps.full_name`
    )
    .all(station_number, profileId, module_code) as { student_id: string; full_name: string; state: string }[]
}

// ─── Disagreements ───────────────────────────────────────────────────────────

export function getDisagreements(
  db: Database.Database,
  module_code: string,
  station_number: number
): { student_id: string; full_name: string }[] {
  const profileId = getActiveProfileId(db)
  return db
    .prepare(
      `SELECT ps.student_id, ps.full_name
       FROM profile_students ps
       JOIN student_enrollments se
        ON se.profile_id=ps.profile_id AND se.student_id=ps.student_id
       JOIN profile_marking_state ms
        ON ms.profile_id=ps.profile_id AND ms.student_id=ps.student_id AND ms.module_code=se.module_code AND ms.station_number=?
       WHERE ps.profile_id=? AND se.module_code=? AND ms.state='DISAGREEMENT'`
    )
    .all(station_number, profileId, module_code) as { student_id: string; full_name: string }[]
}

// ─── App Config ──────────────────────────────────────────────────────────────

export function getConfig(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setConfig(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO app_config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, value)
}

// ─── Dynamic Station Forms ─────────────────────────────────────────────────

export function getStationDefinition(
  db: Database.Database,
  moduleCode: string,
  stationNumber: number
): ProfileStation | null {
  const profileId = getActiveProfileId(db)
  const station = db
    .prepare(
      `SELECT module_code, station_number, label, candidate_instructions
       FROM assessment_stations
       WHERE profile_id = ? AND module_code = ? AND station_number = ?`
    )
    .get(profileId, moduleCode, stationNumber) as Omit<ProfileStation, 'form_fields'> | undefined
  if (!station) return null
  const fields = db
    .prepare(
      `SELECT field_id, label, field_type, max_score, tolerance, required, sort_order
       FROM station_form_fields
       WHERE profile_id = ? AND module_code = ? AND station_number = ?
       ORDER BY sort_order, id`
    )
    .all(profileId, moduleCode, stationNumber) as Array<StationFormField & { required: number }>
  return {
    ...station,
    form_fields: fields.map((field) => ({ ...field, required: Boolean(field.required) }))
  }
}

function getScoreFields(
  db: Database.Database,
  profileId: string,
  moduleCode: string,
  stationNumber: number
): StationFormField[] {
  return (
    db
      .prepare(
        `SELECT field_id, label, field_type, max_score, tolerance, required, sort_order
         FROM station_form_fields
         WHERE profile_id = ? AND module_code = ? AND station_number = ? AND field_type = 'score'
         ORDER BY sort_order, id`
      )
      .all(profileId, moduleCode, stationNumber) as Array<StationFormField & { required: number }>
  ).map((field) => ({ ...field, required: Boolean(field.required) }))
}

function stationMaxScore(fields: StationFormField[]): number {
  return fields.reduce((sum, field) => sum + (field.max_score ?? 0), 0)
}

function stationScoreFromResponses(fields: StationFormField[], responses: FieldResponseInput[]): number | null {
  const byField = new Map(responses.map((r) => [r.field_id, r]))
  let total = 0
  for (const field of fields) {
    const response = byField.get(field.field_id)
    if (field.required && (response?.value_num === null || response?.value_num === undefined)) return null
    if (response?.value_num !== null && response?.value_num !== undefined) total += response.value_num
  }
  return total
}

function loadExaminerResponseSets(
  db: Database.Database,
  profileId: string,
  studentId: string,
  moduleCode: string,
  stationNumber: number
): ExaminerFormMarkDetail[] {
  const rows = db
    .prepare(
      `SELECT examiner_name, field_id, field_type, value_num, value_text, marked_at
       FROM examiner_form_responses
       WHERE profile_id = ? AND student_id = ? AND module_code = ? AND station_number = ?
       ORDER BY marked_at ASC, examiner_name, field_id`
    )
    .all(profileId, studentId, moduleCode, stationNumber) as Array<{
      examiner_name: string
      field_id: string
      field_type: 'score' | 'text'
      value_num: number | null
      value_text: string | null
      marked_at: string
    }>

  const scoreFields = getScoreFields(db, profileId, moduleCode, stationNumber)
  const max = stationMaxScore(scoreFields)
  const grouped = new Map<string, ExaminerFormMarkDetail>()
  for (const row of rows) {
    if (!grouped.has(row.examiner_name)) {
      grouped.set(row.examiner_name, {
        examiner_name: row.examiner_name,
        marked_at: row.marked_at,
        station_score: null,
        station_max_score: max,
        responses: []
      })
    }
    const target = grouped.get(row.examiner_name)!
    if (new Date(row.marked_at).getTime() < new Date(target.marked_at).getTime()) target.marked_at = row.marked_at
    target.responses.push({
      field_id: row.field_id,
      field_type: row.field_type,
      value_num: row.value_num,
      value_text: row.value_text
    })
  }
  return [...grouped.values()]
    .map((mark) => ({ ...mark, station_score: stationScoreFromResponses(scoreFields, mark.responses) }))
    .sort((a, b) => a.marked_at.localeCompare(b.marked_at))
}

function runDynamicAgreementDetection(
  db: Database.Database,
  profileId: string,
  studentId: string,
  moduleCode: string,
  stationNumber: number
): void {
  const scoreFields = getScoreFields(db, profileId, moduleCode, stationNumber)
  const marks = loadExaminerResponseSets(db, profileId, studentId, moduleCode, stationNumber)

  if (marks.length === 1) {
    setMarkingState(db, studentId, moduleCode, stationNumber, 'FIRST_MARK')
    return
  }
  if (marks.length < 2) {
    setMarkingState(db, studentId, moduleCode, stationNumber, 'UNMARKED')
    return
  }

  const first = new Map(marks[0].responses.map((r) => [r.field_id, r]))
  const second = new Map(marks[1].responses.map((r) => [r.field_id, r]))
  const agrees = scoreFields.every((field) => {
    const a = first.get(field.field_id)?.value_num
    const b = second.get(field.field_id)?.value_num
    if (a === null || a === undefined || b === null || b === undefined) return !field.required
    return Math.abs(a - b) <= field.tolerance
  })

  if (!agrees) {
    setMarkingState(db, studentId, moduleCode, stationNumber, 'DISAGREEMENT')
    return
  }

  const resolvedAt = nowIso()
  const insert = db.prepare(`
    INSERT INTO resolved_form_responses
      (profile_id, student_id, module_code, station_number, field_id, value_num, resolution_type, resolved_by, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, 'agreed', NULL, ?)
    ON CONFLICT(profile_id, student_id, module_code, station_number, field_id)
    DO UPDATE SET
      value_num = excluded.value_num,
      resolution_type = 'agreed',
      resolved_by = NULL,
      resolved_at = excluded.resolved_at
  `)
  for (const field of scoreFields) {
    const a = first.get(field.field_id)?.value_num
    const b = second.get(field.field_id)?.value_num
    if (a === null || a === undefined || b === null || b === undefined) continue
    insert.run(profileId, studentId, moduleCode, stationNumber, field.field_id, Math.round((a + b) / 2), resolvedAt)
  }
  setMarkingState(db, studentId, moduleCode, stationNumber, 'AGREED')
}

export function saveExaminerFormResponses(
  db: Database.Database,
  studentId: string,
  moduleCode: string,
  stationNumber: number,
  examinerName: string,
  responses: FieldResponseInput[]
): void {
  const profileId = getActiveProfileId(db)
  const markedAt = nowIso()
  const station = getStationDefinition(db, moduleCode, stationNumber)
  if (!station) throw new Error(`No station configured for ${moduleCode} Station ${stationNumber}`)
  const fieldMap = new Map(station.form_fields.map((field) => [field.field_id, field]))

  const tx = db.transaction(() => {
    db.prepare(`
      DELETE FROM examiner_form_responses
      WHERE profile_id = ? AND student_id = ? AND module_code = ? AND station_number = ? AND examiner_name = ?
    `).run(profileId, studentId, moduleCode, stationNumber, examinerName)

    const insert = db.prepare(`
      INSERT INTO examiner_form_responses
        (profile_id, student_id, module_code, station_number, examiner_name, field_id, field_type, value_num, value_text, marked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const response of responses) {
      const field = fieldMap.get(response.field_id)
      if (!field) continue
      if (field.field_type === 'score') {
        if (response.value_num === null || response.value_num === undefined) continue
        if (response.value_num < 0 || response.value_num > (field.max_score ?? 0)) {
          throw new Error(`${field.label} must be between 0 and ${field.max_score ?? 0}`)
        }
        insert.run(
          profileId,
          studentId,
          moduleCode,
          stationNumber,
          examinerName,
          field.field_id,
          field.field_type,
          response.value_num,
          null,
          markedAt
        )
      } else {
        const text = response.value_text?.trim() ?? ''
        if (!text && !field.required) continue
        insert.run(
          profileId,
          studentId,
          moduleCode,
          stationNumber,
          examinerName,
          field.field_id,
          field.field_type,
          null,
          text,
          markedAt
        )
      }
    }
    runDynamicAgreementDetection(db, profileId, studentId, moduleCode, stationNumber)
  })
  tx()
}

export function getExaminerFormMarksForStation(
  db: Database.Database,
  studentId: string,
  moduleCode: string,
  stationNumber: number
): ExaminerFormMarkDetail[] {
  return loadExaminerResponseSets(db, getActiveProfileId(db), studentId, moduleCode, stationNumber)
}

export function saveDynamicConsensus(
  db: Database.Database,
  studentId: string,
  moduleCode: string,
  stationNumber: number,
  examinerName: string,
  responses: FieldResponseInput[]
): void {
  const profileId = getActiveProfileId(db)
  const scoreFields = getScoreFields(db, profileId, moduleCode, stationNumber)
  const fieldMap = new Map(scoreFields.map((field) => [field.field_id, field]))
  const responseMap = new Map(responses.map((response) => [response.field_id, response]))
  for (const field of scoreFields) {
    const response = responseMap.get(field.field_id)
    if (field.required && (response?.value_num === null || response?.value_num === undefined)) {
      throw new Error(`Consensus score required for ${field.label}`)
    }
  }

  const resolvedAt = nowIso()
  const tx = db.transaction(() => {
    const insert = db.prepare(`
      INSERT INTO resolved_form_responses
        (profile_id, student_id, module_code, station_number, field_id, value_num, resolution_type, resolved_by, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?, ?)
      ON CONFLICT(profile_id, student_id, module_code, station_number, field_id)
      DO UPDATE SET
        value_num = excluded.value_num,
        resolution_type = 'resolved',
        resolved_by = excluded.resolved_by,
        resolved_at = excluded.resolved_at
    `)
    for (const response of responses) {
      const field = fieldMap.get(response.field_id)
      if (!field || response.value_num === null || response.value_num === undefined) continue
      insert.run(profileId, studentId, moduleCode, stationNumber, field.field_id, response.value_num, examinerName, resolvedAt)
    }
    setMarkingState(db, studentId, moduleCode, stationNumber, 'RESOLVED')
  })
  tx()
}

export function hasMarksForActiveProfile(db: Database.Database): boolean {
  const profileId = getActiveProfileId(db)
  const responseCount = (
    db.prepare('SELECT COUNT(*) as c FROM examiner_form_responses WHERE profile_id = ?').get(profileId) as { c: number }
  ).c
  const resolvedCount = (
    db.prepare('SELECT COUNT(*) as c FROM resolved_form_responses WHERE profile_id = ?').get(profileId) as { c: number }
  ).c
  return responseCount + resolvedCount > 0
}
