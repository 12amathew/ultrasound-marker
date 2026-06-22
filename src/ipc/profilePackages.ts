import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { createHash, randomBytes } from 'crypto'
import JSZip from 'jszip'
import type Database from 'better-sqlite3'
import {
  getActiveProfileConfig,
  getActiveProfileId,
  hasMarksForActiveProfile,
  type ProfileConfig
} from '../db/queries'

function nowIso(): string {
  return new Date().toISOString()
}

function cleanCode(value: string): string {
  return value.trim().toUpperCase()
}

function isConclusionField(fieldId: string): boolean {
  return fieldId.toUpperCase().includes('CONCLUSION')
}

function hashPin(pin: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex')
}

export function setAdminPin(db: Database.Database, profileId: string, pin: string): void {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('Admin PIN must be 4-12 digits.')
  const salt = randomBytes(16).toString('hex')
  db.prepare(`
    UPDATE assessment_profiles
    SET admin_pin_salt = ?, admin_pin_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(salt, hashPin(pin, salt), nowIso(), profileId)
}

export function verifyAdminPin(db: Database.Database, profileId: string, pin: string): boolean {
  const row = db
    .prepare('SELECT admin_pin_salt, admin_pin_hash FROM assessment_profiles WHERE id = ?')
    .get(profileId) as { admin_pin_salt: string | null; admin_pin_hash: string | null } | undefined
  if (!row?.admin_pin_salt || !row.admin_pin_hash) return true
  return hashPin(pin, row.admin_pin_salt) === row.admin_pin_hash
}

export function saveProfileConfig(db: Database.Database, cfg: ProfileConfig): ProfileConfig {
  const profileId = cfg.profile.id
  const ts = nowIso()
  const validModuleCodes = new Set(cfg.modules.map((mod) => cleanCode(mod.code)))
  if (validModuleCodes.size !== cfg.modules.length) {
    throw new Error('Each module must have a unique 2-letter code.')
  }
  for (const code of validModuleCodes) {
    if (!/^[A-Z]{2}$/.test(code)) throw new Error(`Invalid module code "${code}". Use 2 uppercase letters.`)
  }
  const oldEnrollments = db
    .prepare('SELECT student_id, module_code FROM student_enrollments WHERE profile_id = ?')
    .all(profileId) as { student_id: string; module_code: string }[]
  const oldStations = db
    .prepare('SELECT module_code, station_number FROM assessment_stations WHERE profile_id = ?')
    .all(profileId) as { module_code: string; station_number: number }[]
  const oldStudents = db
    .prepare('SELECT student_id FROM profile_students WHERE profile_id = ?')
    .all(profileId) as { student_id: string }[]
  const targetRoot = (
    db.prepare('SELECT value FROM app_config WHERE key = ?').get('target_root') as { value: string } | undefined
  )?.value

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO assessment_profiles
        (id, name, is_active, admin_pin_salt, admin_pin_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        admin_pin_salt = COALESCE(assessment_profiles.admin_pin_salt, excluded.admin_pin_salt),
        admin_pin_hash = COALESCE(assessment_profiles.admin_pin_hash, excluded.admin_pin_hash),
        updated_at = excluded.updated_at
    `).run(
      profileId,
      cfg.profile.name,
      cfg.profile.is_active ? 1 : 0,
      cfg.profile.admin_pin_salt,
      cfg.profile.admin_pin_hash,
      cfg.profile.created_at || ts,
      ts
    )
    db.prepare('DELETE FROM examiner_module_assignments WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM assessment_examiners WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM student_enrollments WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM profile_students WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM reference_assets WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM station_form_fields WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM assessment_stations WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM assessment_module_aliases WHERE profile_id = ?').run(profileId)
    db.prepare('DELETE FROM assessment_modules WHERE profile_id = ?').run(profileId)

    const insertModule = db.prepare(`
      INSERT INTO assessment_modules (profile_id, code, name, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertAlias = db.prepare(`
      INSERT OR IGNORE INTO assessment_module_aliases (profile_id, module_code, alias)
      VALUES (?, ?, ?)
    `)
    const insertStation = db.prepare(`
      INSERT INTO assessment_stations
        (profile_id, module_code, station_number, label, candidate_instructions, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertField = db.prepare(`
      INSERT INTO station_form_fields
        (profile_id, module_code, station_number, field_id, label, field_type, min_score, max_score, tolerance, required, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertStudent = db.prepare(`
      INSERT INTO profile_students (profile_id, student_id, full_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, student_id) DO UPDATE SET full_name = excluded.full_name, updated_at = excluded.updated_at
    `)
    const insertEnrollment = db.prepare(`
      INSERT OR IGNORE INTO student_enrollments (profile_id, student_id, module_code, created_at)
      VALUES (?, ?, ?, ?)
    `)
    const insertExaminer = db.prepare(`
      INSERT INTO assessment_examiners (profile_id, name, is_admin, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertAssignment = db.prepare(`
      INSERT OR IGNORE INTO examiner_module_assignments (profile_id, examiner_name, module_code)
      VALUES (?, ?, ?)
    `)

    cfg.modules.forEach((mod, moduleIndex) => {
      const code = cleanCode(mod.code)
      if (!/^[A-Z]{2}$/.test(code)) throw new Error(`Invalid module code "${mod.code}". Use 2 uppercase letters.`)
      insertModule.run(profileId, code, mod.name.trim() || code, moduleIndex, ts, ts)
      const aliases = new Set([code, ...(mod.aliases ?? []).map(cleanCode).filter(Boolean)])
      for (const alias of aliases) insertAlias.run(profileId, code, alias)
      mod.stations.forEach((station, stationIndex) => {
        const stationNumber = Number(station.station_number)
        insertStation.run(
          profileId,
          code,
          stationNumber,
          station.label || `Station ${stationNumber}`,
          station.candidate_instructions ?? null,
          stationIndex,
          ts,
          ts
        )
        station.form_fields.forEach((field, fieldIndex) => {
          const fieldId = field.field_id.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || `FIELD_${fieldIndex + 1}`
          const isConclusion = field.field_type === 'score' && isConclusionField(fieldId)
          const minScore = field.field_type === 'score' ? (isConclusion ? 0 : field.min_score ?? 0) : null
          const maxScore = field.field_type === 'score' ? (isConclusion ? 1 : field.max_score ?? 10) : null
          if (minScore !== null && maxScore !== null && maxScore < minScore) {
            throw new Error(`${field.label || fieldId} maximum score must be greater than or equal to its minimum score.`)
          }
          insertField.run(
            profileId,
            code,
            stationNumber,
            fieldId,
            field.label.trim() || fieldId,
            field.field_type,
            minScore,
            maxScore,
            field.tolerance ?? 1,
            field.required ? 1 : 0,
            fieldIndex,
            ts,
            ts
          )
        })
      })
    })

    cfg.students.forEach((student) => {
      const studentId = student.student_id.trim().replace(/\D/g, '')
      if (!studentId) return
      insertStudent.run(profileId, studentId, student.full_name.trim() || studentId, ts, ts)
      for (const moduleCode of student.module_codes.map(cleanCode)) {
        if (moduleCode && validModuleCodes.has(moduleCode)) insertEnrollment.run(profileId, studentId, moduleCode, ts)
      }
    })

    cfg.examiners.forEach((examiner, index) => {
      const name = examiner.name.trim()
      if (!name) return
      insertExaminer.run(profileId, name, examiner.is_admin ? 1 : 0, index, ts, ts)
      for (const moduleCode of examiner.module_codes ?? []) {
        const cleanModuleCode = cleanCode(moduleCode)
        if (validModuleCodes.has(cleanModuleCode)) insertAssignment.run(profileId, name, cleanModuleCode)
      }
    })

    db.prepare(`
      DELETE FROM examiner_form_responses
      WHERE profile_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM student_enrollments se
          WHERE se.profile_id = examiner_form_responses.profile_id
            AND se.student_id = examiner_form_responses.student_id
            AND se.module_code = examiner_form_responses.module_code
        )
    `).run(profileId)
    db.prepare(`
      DELETE FROM examiner_form_responses
      WHERE profile_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM assessment_stations st
          WHERE st.profile_id = examiner_form_responses.profile_id
            AND st.module_code = examiner_form_responses.module_code
            AND st.station_number = examiner_form_responses.station_number
        )
    `).run(profileId)
    db.prepare(`
      DELETE FROM examiner_form_responses
      WHERE profile_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM station_form_fields f
          WHERE f.profile_id = examiner_form_responses.profile_id
            AND f.module_code = examiner_form_responses.module_code
            AND f.station_number = examiner_form_responses.station_number
            AND f.field_id = examiner_form_responses.field_id
        )
    `).run(profileId)
    db.prepare(`
      DELETE FROM resolved_form_responses
      WHERE profile_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM station_form_fields f
          WHERE f.profile_id = resolved_form_responses.profile_id
            AND f.module_code = resolved_form_responses.module_code
            AND f.station_number = resolved_form_responses.station_number
            AND f.field_id = resolved_form_responses.field_id
        )
    `).run(profileId)
    db.prepare(`
      DELETE FROM profile_marking_state
      WHERE profile_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM student_enrollments se
          JOIN assessment_stations st
            ON st.profile_id = se.profile_id AND st.module_code = se.module_code
          WHERE se.profile_id = profile_marking_state.profile_id
            AND se.student_id = profile_marking_state.student_id
            AND se.module_code = profile_marking_state.module_code
            AND st.station_number = profile_marking_state.station_number
        )
    `).run(profileId)
    db.prepare(`
      DELETE FROM profile_marking_locks
      WHERE profile_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM student_enrollments se
          JOIN assessment_stations st
            ON st.profile_id = se.profile_id AND st.module_code = se.module_code
          WHERE se.profile_id = profile_marking_locks.profile_id
            AND se.student_id = profile_marking_locks.student_id
            AND se.module_code = profile_marking_locks.module_code
            AND st.station_number = profile_marking_locks.station_number
        )
    `).run(profileId)
  })
  tx()

  if (targetRoot) {
    const newEnrollmentSet = new Set(cfg.students.flatMap((s) => s.module_codes.map((m) => `${s.student_id}:${cleanCode(m)}`)))
    const newStudentSet = new Set(cfg.students.map((s) => s.student_id))
    const newStationSet = new Set(cfg.modules.flatMap((m) => m.stations.map((s) => `${cleanCode(m.code)}:${s.station_number}`)))
    for (const student of oldStudents) {
      if (!newStudentSet.has(student.student_id)) {
        try { rmSync(join(targetRoot, student.student_id), { recursive: true, force: true }) } catch { /* non-fatal */ }
      }
    }
    for (const enrollment of oldEnrollments) {
      if (!newEnrollmentSet.has(`${enrollment.student_id}:${enrollment.module_code}`)) {
        try { rmSync(join(targetRoot, enrollment.student_id, enrollment.module_code), { recursive: true, force: true }) } catch { /* non-fatal */ }
      }
    }
    const activeStudents = cfg.students.map((s) => s.student_id)
    for (const station of oldStations) {
      if (!newStationSet.has(`${station.module_code}:${station.station_number}`)) {
        for (const studentId of activeStudents) {
          try {
            rmSync(join(targetRoot, studentId, station.module_code, 'Practical', `Station ${station.station_number}`), {
              recursive: true,
              force: true
            })
          } catch {
            // non-fatal
          }
        }
      }
    }
  }
  return getActiveProfileConfig(db)!
}

export async function exportProfilePackage(db: Database.Database, outputPath: string): Promise<void> {
  const cfg = getActiveProfileConfig(db)
  if (!cfg) throw new Error('No active profile configured.')
  const zip = new JSZip()
  zip.file('assessment.json', JSON.stringify(cfg, null, 2))
  const assetsFolder = zip.folder('references')!

  const refRoot = (
    db.prepare('SELECT value FROM app_config WHERE key = ?').get('reference_images_root') as { value: string } | undefined
  )?.value
  if (refRoot && existsSync(refRoot)) {
    for (const entry of readdirSync(refRoot)) {
      const fullPath = join(refRoot, entry)
      try {
        if (statSync(fullPath).isFile()) assetsFolder.file(entry, readFileSync(fullPath))
      } catch {
        // Ignore unreadable reference files; the app can still export the settings manifest.
      }
    }
  }

  const assets = db
    .prepare('SELECT label, file_path FROM reference_assets WHERE profile_id = ? ORDER BY sort_order, id')
    .all(cfg.profile.id) as { label: string; file_path: string }[]
  for (const asset of assets) {
    if (existsSync(asset.file_path)) {
      assetsFolder.file(`${asset.label}-${basename(asset.file_path)}`, readFileSync(asset.file_path))
    }
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  writeFileSync(outputPath, bytes)
}

export async function importProfilePackage(
  db: Database.Database,
  inputPath: string,
  userDataDir: string,
  forceReplace: boolean
): Promise<{ success: boolean; warning?: string }> {
  const zip = await JSZip.loadAsync(readFileSync(inputPath))
  const assessmentFile = zip.file('assessment.json')
  if (!assessmentFile) throw new Error('Package is missing assessment.json.')
  const cfg = JSON.parse(await assessmentFile.async('string')) as ProfileConfig
  if (!cfg?.profile?.id || !Array.isArray(cfg.modules)) throw new Error('Invalid assessment package.')

  const existing = db
    .prepare('SELECT id FROM assessment_profiles WHERE id = ?')
    .get(cfg.profile.id) as { id: string } | undefined
  if (existing) {
    const currentActive = getActiveProfileId(db)
    db.prepare('UPDATE assessment_profiles SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(cfg.profile.id)
    const hasMarks = hasMarksForActiveProfile(db)
    db.prepare('UPDATE assessment_profiles SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(currentActive)
    if (hasMarks && !forceReplace) {
      return { success: false, warning: 'This profile already has marks. Back up first or force replace.' }
    }
  } else {
    db.prepare(`
      INSERT INTO assessment_profiles
        (id, name, is_active, admin_pin_salt, admin_pin_hash, created_at, updated_at)
      VALUES (?, ?, 0, ?, ?, ?, ?)
    `).run(
      cfg.profile.id,
      cfg.profile.name,
      cfg.profile.admin_pin_salt,
      cfg.profile.admin_pin_hash,
      cfg.profile.created_at ?? nowIso(),
      nowIso()
    )
  }

  saveProfileConfig(db, cfg)
  db.prepare(`
    UPDATE assessment_profiles
    SET admin_pin_salt = ?, admin_pin_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(cfg.profile.admin_pin_salt, cfg.profile.admin_pin_hash, nowIso(), cfg.profile.id)
  db.prepare('UPDATE assessment_profiles SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(cfg.profile.id)

  const refsDir = join(userDataDir, 'profile-references', cfg.profile.id)
  if (!existsSync(refsDir)) mkdirSync(refsDir, { recursive: true })
  const refFolder = zip.folder('references')
  if (refFolder) {
    const files = Object.values(refFolder.files).filter((file) => !file.dir)
    for (const file of files) {
      const data = await file.async('nodebuffer')
      writeFileSync(join(refsDir, basename(file.name)), data)
    }
    db.prepare(`
      INSERT INTO app_config (key, value) VALUES ('reference_images_root', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(refsDir)
  }

  return { success: true }
}
