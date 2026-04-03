import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  // Enable WAL mode for concurrent readers/writers
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id    TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      module_code   TEXT NOT NULL,
      UNIQUE(student_id, module_code)
    );

    CREATE TABLE IF NOT EXISTS examiner_marks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id        TEXT NOT NULL,
      module_code       TEXT NOT NULL,
      station_number    INTEGER NOT NULL,
      examiner_name     TEXT NOT NULL,
      img1_mark         INTEGER,
      img2_mark         INTEGER,
      conclusion_mark   INTEGER,
      station_score     REAL,
      marked_at         TEXT,
      UNIQUE(student_id, module_code, station_number, examiner_name)
    );

    CREATE TABLE IF NOT EXISTS marking_locks (
      student_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      locked_by       TEXT NOT NULL,
      locked_at       TEXT NOT NULL,
      PRIMARY KEY (student_id, module_code, station_number)
    );

    CREATE TABLE IF NOT EXISTS marking_state (
      student_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      state           TEXT NOT NULL DEFAULT 'UNMARKED',
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (student_id, module_code, station_number)
    );

    CREATE TABLE IF NOT EXISTS resolved_marks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id        TEXT NOT NULL,
      module_code       TEXT NOT NULL,
      station_number    INTEGER NOT NULL,
      img1_mark         INTEGER NOT NULL,
      img2_mark         INTEGER NOT NULL,
      conclusion_mark   INTEGER,
      station_score     REAL NOT NULL,
      resolution_type   TEXT NOT NULL,
      resolved_by       TEXT,
      resolved_at       TEXT NOT NULL,
      UNIQUE(student_id, module_code, station_number)
    );

    CREATE TABLE IF NOT EXISTS theory_marks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      physics_score   INTEGER,
      module_score    INTEGER,
      UNIQUE(student_id, module_code)
    );

    CREATE TABLE IF NOT EXISTS file_sort_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at        TEXT NOT NULL,
      source_path   TEXT NOT NULL,
      dest_path     TEXT,
      status        TEXT NOT NULL,
      reason        TEXT
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS excluded_enrollments (
      student_id    TEXT NOT NULL,
      module_code   TEXT NOT NULL,
      reason        TEXT,
      PRIMARY KEY (student_id, module_code)
    );

    -- Students who are enrolled in a module per records but did not sit the assessments.
    -- INSERT OR IGNORE so re-running initSchema on an existing DB is safe.
    INSERT OR IGNORE INTO excluded_enrollments (student_id, module_code, reason)
    VALUES ('100114827', 'AS', 'Student did not sit AS practical assessments');
  `)
}
