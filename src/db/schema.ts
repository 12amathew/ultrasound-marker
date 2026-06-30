import type Database from 'better-sqlite3'
import stationsConfig from '../../config/stations.json'

const LEGACY_PROFILE_ID = 'legacy-assessment'

function sqlJson(value: unknown): string {
  return JSON.stringify(value)
}

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

    CREATE TABLE IF NOT EXISTS setup_config (
      id                    INTEGER PRIMARY KEY CHECK (id = 1),
      target_root           TEXT NOT NULL,
      reference_images_root TEXT NOT NULL,
      source_path           TEXT,
      configured_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessment_profiles (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      is_active           INTEGER NOT NULL DEFAULT 0,
      admin_pin_salt      TEXT,
      admin_pin_hash      TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assessment_modules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id    TEXT NOT NULL,
      code          TEXT NOT NULL,
      name          TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE(profile_id, code),
      FOREIGN KEY(profile_id) REFERENCES assessment_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_module_aliases (
      profile_id    TEXT NOT NULL,
      module_code   TEXT NOT NULL,
      alias         TEXT NOT NULL,
      PRIMARY KEY(profile_id, alias),
      FOREIGN KEY(profile_id, module_code)
        REFERENCES assessment_modules(profile_id, code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dicom_station_mappings (
      profile_id             TEXT NOT NULL,
      module_code            TEXT NOT NULL,
      source_station_number  INTEGER NOT NULL CHECK(source_station_number > 0),
      target_station_number  INTEGER NOT NULL CHECK(target_station_number > 0),
      PRIMARY KEY(profile_id, module_code, source_station_number),
      FOREIGN KEY(profile_id, module_code)
        REFERENCES assessment_modules(profile_id, code) ON DELETE CASCADE,
      FOREIGN KEY(profile_id, module_code, target_station_number)
        REFERENCES assessment_stations(profile_id, module_code, station_number) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_stations (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id              TEXT NOT NULL,
      module_code             TEXT NOT NULL,
      station_number          INTEGER NOT NULL,
      label                   TEXT NOT NULL,
      candidate_instructions  TEXT,
      sort_order              INTEGER NOT NULL DEFAULT 0,
      created_at              TEXT NOT NULL,
      updated_at              TEXT NOT NULL,
      UNIQUE(profile_id, module_code, station_number),
      FOREIGN KEY(profile_id, module_code)
        REFERENCES assessment_modules(profile_id, code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS station_form_fields (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      field_id        TEXT NOT NULL,
      label           TEXT NOT NULL,
      field_type      TEXT NOT NULL CHECK(field_type IN ('score', 'text')),
      min_score       INTEGER,
      max_score       INTEGER,
      tolerance       INTEGER NOT NULL DEFAULT 1,
      required        INTEGER NOT NULL DEFAULT 1,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE(profile_id, module_code, station_number, field_id),
      FOREIGN KEY(profile_id, module_code, station_number)
        REFERENCES assessment_stations(profile_id, module_code, station_number) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reference_assets (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      asset_id        TEXT NOT NULL,
      label           TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE(profile_id, module_code, station_number, asset_id),
      FOREIGN KEY(profile_id, module_code, station_number)
        REFERENCES assessment_stations(profile_id, module_code, station_number) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS profile_students (
      profile_id    TEXT NOT NULL,
      student_id    TEXT NOT NULL,
      full_name     TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      PRIMARY KEY(profile_id, student_id),
      FOREIGN KEY(profile_id) REFERENCES assessment_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_enrollments (
      profile_id    TEXT NOT NULL,
      student_id    TEXT NOT NULL,
      module_code   TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      PRIMARY KEY(profile_id, student_id, module_code),
      FOREIGN KEY(profile_id, student_id)
        REFERENCES profile_students(profile_id, student_id) ON DELETE CASCADE,
      FOREIGN KEY(profile_id, module_code)
        REFERENCES assessment_modules(profile_id, code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assessment_examiners (
      profile_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      PRIMARY KEY(profile_id, name),
      FOREIGN KEY(profile_id) REFERENCES assessment_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS examiner_module_assignments (
      profile_id      TEXT NOT NULL,
      examiner_name   TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      PRIMARY KEY(profile_id, examiner_name, module_code),
      FOREIGN KEY(profile_id, examiner_name)
        REFERENCES assessment_examiners(profile_id, name) ON DELETE CASCADE,
      FOREIGN KEY(profile_id, module_code)
        REFERENCES assessment_modules(profile_id, code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS profile_marking_locks (
      profile_id      TEXT NOT NULL,
      student_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      locked_by       TEXT NOT NULL,
      locked_at       TEXT NOT NULL,
      PRIMARY KEY(profile_id, student_id, module_code, station_number)
    );

    CREATE TABLE IF NOT EXISTS profile_marking_state (
      profile_id      TEXT NOT NULL,
      student_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      state           TEXT NOT NULL DEFAULT 'UNMARKED',
      updated_at      TEXT NOT NULL,
      PRIMARY KEY(profile_id, student_id, module_code, station_number)
    );

    CREATE TABLE IF NOT EXISTS examiner_form_responses (
      profile_id      TEXT NOT NULL,
      student_id      TEXT NOT NULL,
      module_code     TEXT NOT NULL,
      station_number  INTEGER NOT NULL,
      examiner_name   TEXT NOT NULL,
      field_id        TEXT NOT NULL,
      field_type      TEXT NOT NULL CHECK(field_type IN ('score', 'text')),
      value_num       INTEGER,
      value_text      TEXT,
      marked_at       TEXT NOT NULL,
      PRIMARY KEY(profile_id, student_id, module_code, station_number, examiner_name, field_id)
    );

    CREATE TABLE IF NOT EXISTS resolved_form_responses (
      profile_id       TEXT NOT NULL,
      student_id       TEXT NOT NULL,
      module_code      TEXT NOT NULL,
      station_number   INTEGER NOT NULL,
      field_id         TEXT NOT NULL,
      value_num        INTEGER NOT NULL,
      resolution_type  TEXT NOT NULL,
      resolved_by      TEXT,
      resolved_at      TEXT NOT NULL,
      PRIMARY KEY(profile_id, student_id, module_code, station_number, field_id)
    );

    CREATE TABLE IF NOT EXISTS excluded_enrollments (
      student_id    TEXT NOT NULL,
      module_code   TEXT NOT NULL,
      reason        TEXT,
      PRIMARY KEY (student_id, module_code)
    );

    CREATE TABLE IF NOT EXISTS dicom_server_config (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      orthanc_base_url  TEXT NOT NULL,
      ohif_base_url     TEXT NOT NULL,
      configured_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dicom_import_runs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at            TEXT NOT NULL,
      orthanc_base_url  TEXT NOT NULL,
      ohif_base_url     TEXT NOT NULL,
      studies_scanned   INTEGER NOT NULL,
      matched           INTEGER NOT NULL,
      unresolved        INTEGER NOT NULL,
      errors            INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dicom_study_links (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id          TEXT NOT NULL,
      student_short_id    TEXT NOT NULL,
      module_code         TEXT NOT NULL,
      station_number      INTEGER NOT NULL,
      patient_id          TEXT NOT NULL,
      study_instance_uid  TEXT NOT NULL,
      orthanc_study_id    TEXT NOT NULL,
      study_description   TEXT,
      study_date          TEXT,
      modality            TEXT,
      series_count        INTEGER NOT NULL DEFAULT 0,
      instance_count      INTEGER NOT NULL DEFAULT 0,
      ohif_url            TEXT NOT NULL,
      imported_at         TEXT NOT NULL,
      preview_count       INTEGER,
      preview_error       TEXT,
      preview_checked_at  TEXT,
      UNIQUE(student_id, module_code, station_number, study_instance_uid)
    );

    CREATE INDEX IF NOT EXISTS idx_dicom_study_links_station
      ON dicom_study_links(student_id, module_code, station_number);

    CREATE TABLE IF NOT EXISTS reference_dicom_links (
      profile_id            TEXT NOT NULL,
      module_code           TEXT NOT NULL,
      station_number        INTEGER NOT NULL,
      slot                  INTEGER NOT NULL CHECK(slot IN (1, 2)),
      patient_id            TEXT NOT NULL,
      study_instance_uid    TEXT NOT NULL,
      orthanc_study_id      TEXT NOT NULL,
      study_description     TEXT,
      study_date            TEXT,
      modality              TEXT,
      series_count          INTEGER NOT NULL DEFAULT 0,
      instance_count        INTEGER NOT NULL DEFAULT 0,
      ohif_url              TEXT NOT NULL,
      linked_at             TEXT NOT NULL,
      preview_count         INTEGER,
      preview_error         TEXT,
      preview_checked_at    TEXT,
      PRIMARY KEY(profile_id, module_code, station_number, slot),
      FOREIGN KEY(profile_id, module_code, station_number)
        REFERENCES assessment_stations(profile_id, module_code, station_number) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dicom_unresolved_studies (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id              INTEGER,
      orthanc_study_id    TEXT,
      patient_id          TEXT,
      study_instance_uid  TEXT,
      reason              TEXT NOT NULL,
      raw_metadata        TEXT,
      seen_at             TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES dicom_import_runs(id)
    );

    -- Students who are enrolled in a module per records but did not sit the assessments.
    -- INSERT OR IGNORE so re-running initSchema on an existing DB is safe.
    INSERT OR IGNORE INTO excluded_enrollments (student_id, module_code, reason)
    VALUES ('100114827', 'AS', 'Student did not sit AS practical assessments');
  `)

  // Migration: add source_path to setup_config if it doesn't exist yet
  try {
    db.exec(`ALTER TABLE setup_config ADD COLUMN source_path TEXT`)
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec(`ALTER TABLE station_form_fields ADD COLUMN min_score INTEGER`)
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec(`ALTER TABLE dicom_study_links ADD COLUMN preview_count INTEGER`)
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec(`ALTER TABLE dicom_study_links ADD COLUMN preview_error TEXT`)
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.exec(`ALTER TABLE dicom_study_links ADD COLUMN preview_checked_at TEXT`)
  } catch {
    // Column already exists — safe to ignore
  }

  seedLegacyProfile(db)
}

function seedLegacyProfile(db: Database.Database): void {
  const now = new Date().toISOString()
  const profileCount = (db.prepare('SELECT COUNT(*) as c FROM assessment_profiles').get() as { c: number }).c
  if (profileCount === 0) {
    db.prepare(`
      INSERT INTO assessment_profiles (id, name, is_active, created_at, updated_at)
      VALUES (?, 'Legacy assessment', 1, ?, ?)
    `).run(LEGACY_PROFILE_ID, now, now)
  }

  const activeProfile =
    (db.prepare('SELECT id FROM assessment_profiles WHERE is_active = 1 LIMIT 1').get() as { id: string } | undefined)
      ?.id ?? LEGACY_PROFILE_ID

  const moduleCount = (
    db.prepare('SELECT COUNT(*) as c FROM assessment_modules WHERE profile_id = ?').get(activeProfile) as { c: number }
  ).c
  if (moduleCount === 0) {
    const insertModule = db.prepare(`
      INSERT OR IGNORE INTO assessment_modules
        (profile_id, code, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertAlias = db.prepare(`
      INSERT OR IGNORE INTO assessment_module_aliases (profile_id, module_code, alias)
      VALUES (?, ?, ?)
    `)
    const insertStation = db.prepare(`
      INSERT OR IGNORE INTO assessment_stations
        (profile_id, module_code, station_number, label, candidate_instructions, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertField = db.prepare(`
      INSERT OR IGNORE INTO station_form_fields
        (profile_id, module_code, station_number, field_id, label, field_type, min_score, max_score, tolerance, required, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const [moduleIndex, mod] of stationsConfig.modules.entries()) {
      insertModule.run(activeProfile, mod.code, mod.name, moduleIndex, now, now)
      insertAlias.run(activeProfile, mod.code, mod.code)
      for (const [stationIndex, station] of mod.stations.entries()) {
        insertStation.run(
          activeProfile,
          mod.code,
          station.number,
          station.label,
          station.candidate_instructions ?? null,
          stationIndex,
          now,
          now
        )
        insertField.run(activeProfile, mod.code, station.number, 'IMG1', 'Image 1', 'score', 0, 10, 1, 1, 0, now, now)
        insertField.run(activeProfile, mod.code, station.number, 'IMG2', 'Image 2', 'score', 0, 10, 1, 1, 1, now, now)
        if (station.has_conclusion) {
          insertField.run(
            activeProfile,
            mod.code,
            station.number,
            'CONCLUSION',
            'Conclusion',
            'score',
            0,
            1,
            1,
            1,
            2,
            now,
            now
          )
          if (station.conclusion_reference_text) {
            insertField.run(
              activeProfile,
              mod.code,
              station.number,
              'CONCLUSION_NOTE',
              'Model answer',
              'text',
              null,
              null,
              1,
              0,
              3,
              now,
              now
            )
          }
        }
      }
    }
  }

  const insertExaminer = db.prepare(`
    INSERT OR IGNORE INTO assessment_examiners
      (profile_id, name, is_admin, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  ;['Ian Stell', 'Giles Cattermole', 'George Nada'].forEach((name, index) => {
    insertExaminer.run(activeProfile, name, index === 0 ? 1 : 0, index, now, now)
  })

  db.prepare(`
    INSERT OR IGNORE INTO examiner_module_assignments (profile_id, examiner_name, module_code)
    SELECT ?, 'Giles Cattermole', code FROM assessment_modules
    WHERE profile_id = ? AND code IN ('HD', 'AS', 'LM')
  `).run(activeProfile, activeProfile)
  db.prepare(`
    INSERT OR IGNORE INTO examiner_module_assignments (profile_id, examiner_name, module_code)
    SELECT ?, 'George Nada', code FROM assessment_modules
    WHERE profile_id = ? AND code IN ('FC', 'NB', 'PR')
  `).run(activeProfile, activeProfile)

  db.prepare(`
    INSERT OR IGNORE INTO profile_students (profile_id, student_id, full_name, created_at, updated_at)
    SELECT ?, student_id, MAX(full_name), ?, ? FROM students GROUP BY student_id
  `).run(activeProfile, now, now)
  db.prepare(`
    INSERT OR IGNORE INTO student_enrollments (profile_id, student_id, module_code, created_at)
    SELECT ?, student_id, module_code, ? FROM students
  `).run(activeProfile, now)

  db.prepare(`
    INSERT OR IGNORE INTO examiner_form_responses
      (profile_id, student_id, module_code, station_number, examiner_name, field_id, field_type, value_num, value_text, marked_at)
    SELECT ?, student_id, module_code, station_number, examiner_name, 'IMG1', 'score', img1_mark, NULL, marked_at
    FROM examiner_marks WHERE img1_mark IS NOT NULL
  `).run(activeProfile)
  db.prepare(`
    INSERT OR IGNORE INTO examiner_form_responses
      (profile_id, student_id, module_code, station_number, examiner_name, field_id, field_type, value_num, value_text, marked_at)
    SELECT ?, student_id, module_code, station_number, examiner_name, 'IMG2', 'score', img2_mark, NULL, marked_at
    FROM examiner_marks WHERE img2_mark IS NOT NULL
  `).run(activeProfile)
  db.prepare(`
    INSERT OR IGNORE INTO examiner_form_responses
      (profile_id, student_id, module_code, station_number, examiner_name, field_id, field_type, value_num, value_text, marked_at)
    SELECT ?, student_id, module_code, station_number, examiner_name, 'CONCLUSION', 'score', conclusion_mark, NULL, marked_at
    FROM examiner_marks WHERE conclusion_mark IS NOT NULL
  `).run(activeProfile)

  // Keep JSON helper referenced so future package payloads use consistent serialization.
  void sqlJson
}
