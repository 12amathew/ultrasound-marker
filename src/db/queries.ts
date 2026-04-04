import type Database from 'better-sqlite3'
import type { MarkingState } from '../types'

// ─── Scoring ────────────────────────────────────────────────────────────────

export function calcStationScore(
  img1: number,
  img2: number,
  conclusion: number | null
): number {
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
  db.prepare(`
    INSERT INTO students (student_id, full_name, module_code)
    VALUES (?, ?, ?)
    ON CONFLICT(student_id, module_code) DO UPDATE SET full_name = excluded.full_name
  `).run(student_id, full_name, module_code)
}

export function getStudentsByModule(
  db: Database.Database,
  module_code: string
): { student_id: string; full_name: string; module_code: string }[] {
  return db
    .prepare('SELECT student_id, full_name, module_code FROM students WHERE module_code = ?')
    .all(module_code) as { student_id: string; full_name: string; module_code: string }[]
}

export function getStudentByShortId(
  db: Database.Database,
  short_id: string,
  module_code: string
): { student_id: string; full_name: string } | null {
  return (
    (db
      .prepare(
        `SELECT student_id, full_name FROM students
         WHERE module_code = ? AND substr(student_id, -6) = ?`
      )
      .get(module_code, short_id) as { student_id: string; full_name: string } | undefined) ?? null
  )
}

/** Find a student by short ID across all modules. Returns all matches. */
export function getStudentByShortIdAnyModule(
  db: Database.Database,
  short_id: string
): { student_id: string; full_name: string; module_code: string }[] {
  return db
    .prepare(
      `SELECT student_id, full_name, module_code FROM students
       WHERE substr(student_id, -6) = ?`
    )
    .all(short_id) as { student_id: string; full_name: string; module_code: string }[]
}

// ─── Marking State ───────────────────────────────────────────────────────────

export function getMarkingState(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number
): MarkingState {
  const row = db
    .prepare(
      'SELECT state FROM marking_state WHERE student_id=? AND module_code=? AND station_number=?'
    )
    .get(student_id, module_code, station_number) as { state: MarkingState } | undefined
  return row?.state ?? 'UNMARKED'
}

export function setMarkingState(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number,
  state: MarkingState
): void {
  db.prepare(`
    INSERT INTO marking_state (student_id, module_code, station_number, state, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, module_code, station_number)
    DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `).run(student_id, module_code, station_number, state, new Date().toISOString())
}

// ─── Examiner Marks ──────────────────────────────────────────────────────────

export function saveExaminerMark(
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
  const station_score = calcStationScore(img1_mark, img2_mark, has_conclusion ? conclusion_mark : null)
  const marked_at = new Date().toISOString()

  db.prepare(`
    INSERT INTO examiner_marks
      (student_id, module_code, station_number, examiner_name, img1_mark, img2_mark, conclusion_mark, station_score, marked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      img1_mark: number; img2_mark: number; conclusion_mark: number | null
      station_score: number; examiner_name: string
    }>

  if (marks.length === 1) {
    setMarkingState(db, student_id, module_code, station_number, 'FIRST_MARK')
  } else if (marks.length === 2) {
    runAgreementDetection(db, student_id, module_code, station_number, marks[0], marks[1], has_conclusion)
  }
}

export interface ExaminerMarkDetail {
  examiner_name: string
  img1_mark: number
  img2_mark: number
  conclusion_mark: number | null
  station_score: number
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

    const score = calcStationScore(img1, img2, has_conclusion ? conclusion : null)
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
  const score = calcStationScore(img1_mark, img2_mark, has_conclusion ? conclusion_mark : null)
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
  const now = new Date()
  const existing = db
    .prepare(
      'SELECT locked_by, locked_at FROM marking_locks WHERE student_id=? AND module_code=? AND station_number=?'
    )
    .get(student_id, module_code, station_number) as { locked_by: string; locked_at: string } | undefined

  if (existing) {
    const age = now.getTime() - new Date(existing.locked_at).getTime()
    if (age < LOCK_TIMEOUT_MS) {
      // Active lock held by someone else
      return false
    }
    // Stale lock — overwrite
  }

  db.prepare(`
    INSERT INTO marking_locks (student_id, module_code, station_number, locked_by, locked_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, module_code, station_number)
    DO UPDATE SET locked_by=excluded.locked_by, locked_at=excluded.locked_at
  `).run(student_id, module_code, station_number, examiner_name, now.toISOString())

  return true
}

export function releaseLock(
  db: Database.Database,
  student_id: string,
  module_code: string,
  station_number: number
): void {
  db.prepare(
    'DELETE FROM marking_locks WHERE student_id=? AND module_code=? AND station_number=?'
  ).run(student_id, module_code, station_number)
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
  const total = (
    db.prepare('SELECT COUNT(*) as c FROM students WHERE module_code=?').get(module_code) as { c: number }
  ).c

  const marked_by_me = (
    db.prepare(
      `SELECT COUNT(*) as c FROM examiner_marks
       WHERE module_code=? AND station_number=? AND lower(examiner_name)=lower(?)`
    ).get(module_code, station_number, examiner_name) as { c: number }
  ).c

  const stateRows = db
    .prepare(
      `SELECT state, COUNT(*) as c FROM marking_state
       WHERE module_code=? AND station_number=?
       GROUP BY state`
    )
    .all(module_code, station_number) as { state: string; c: number }[]

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
  const now = new Date()
  const lockCutoff = new Date(now.getTime() - LOCK_TIMEOUT_MS).toISOString()

  // Build exclusion list: already marked by this examiner + skip list
  const alreadyMarked = db
    .prepare(
      `SELECT student_id FROM examiner_marks
       WHERE module_code=? AND station_number=? AND lower(examiner_name)=lower(?)`
    )
    .all(module_code, station_number, examiner_name)
    .map((r: unknown) => (r as { student_id: string }).student_id)

  const excluded = [...new Set([...alreadyMarked, ...skipList])]

  // Locked students (active locks not by this examiner)
  const locked = db
    .prepare(
      `SELECT student_id FROM marking_locks
       WHERE module_code=? AND station_number=?
       AND locked_at > ? AND lower(locked_by) != lower(?)`
    )
    .all(module_code, station_number, lockCutoff, examiner_name)
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
        SELECT s.student_id, s.full_name
        FROM students s
        LEFT JOIN marking_state ms
          ON ms.student_id=s.student_id AND ms.module_code=s.module_code AND ms.station_number=?
        WHERE s.module_code=?
          AND (ms.state IS NULL OR ms.state='UNMARKED')
          ${hasExclusions ? `AND s.student_id NOT IN (${placeholders})` : ''}
        LIMIT 1
      `
      params = [station_number, module_code, ...allExcluded]
    } else {
      query = `
        SELECT s.student_id, s.full_name
        FROM students s
        JOIN marking_state ms
          ON ms.student_id=s.student_id AND ms.module_code=s.module_code AND ms.station_number=?
        WHERE s.module_code=?
          AND ms.state='FIRST_MARK'
          ${hasExclusions ? `AND s.student_id NOT IN (${placeholders})` : ''}
        LIMIT 1
      `
      params = [station_number, module_code, ...allExcluded]
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
  return db
    .prepare(
      `SELECT s.student_id, s.full_name,
              COALESCE(ms.state, 'UNMARKED') as state
       FROM students s
       LEFT JOIN marking_state ms
         ON ms.student_id = s.student_id
         AND ms.module_code = s.module_code
         AND ms.station_number = ?
       WHERE s.module_code = ?
       ORDER BY s.full_name`
    )
    .all(station_number, module_code) as { student_id: string; full_name: string; state: string }[]
}

// ─── Disagreements ───────────────────────────────────────────────────────────

export function getDisagreements(
  db: Database.Database,
  module_code: string,
  station_number: number
): { student_id: string; full_name: string }[] {
  return db
    .prepare(
      `SELECT s.student_id, s.full_name
       FROM students s
       JOIN marking_state ms ON ms.student_id=s.student_id AND ms.module_code=s.module_code AND ms.station_number=?
       WHERE s.module_code=? AND ms.state='DISAGREEMENT'`
    )
    .all(station_number, module_code) as { student_id: string; full_name: string }[]
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
