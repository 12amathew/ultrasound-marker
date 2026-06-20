import { readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join, extname, basename, dirname, resolve } from 'path'
import type Database from 'better-sqlite3'
import { getStudentByShortId, getStudentByShortIdAnyModule, resolveModuleAlias } from '../db/queries'
import type { FileSortResult } from '../types/ipc'

const IMAGE_EXTS = new Set(['.tif', '.tiff', '.jpg', '.jpeg', '.png'])
const CONCLUSION_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.tif', '.tiff'])

// Folder name pattern after stripping P1/P2 prefix:
// S<stationNum><ModuleCode><ShortID>  e.g. S1HD178039 or S8AS153883
const FOLDER_PATTERN = /^S(\d)([A-Z]{2})(\d{6})/

interface ParsedFolder {
  stationNumber: number
  moduleCode: string
  shortId: string
}

function parseFolderName(name: string): ParsedFolder | null {
  // Step 1: strip underscores
  let s = name.replace(/_/g, '')
  // Step 2: uppercase
  s = s.toUpperCase()
  // Step 3: strip leading P followed by one or more digits (P1, P2, P10, etc.)
  s = s.replace(/^P\d+/, '')
  // Step 4: match pattern
  const m = FOLDER_PATTERN.exec(s)
  if (!m) return null
  const moduleCode = m[2]
  return {
    stationNumber: parseInt(m[1], 10),
    moduleCode,
    shortId: m[3]
  }
}

/**
 * Try to extract student/station info from a file name.
 * Handles names like: P6S1FC169214_03.25.2026.14.54.29_1.jpg
 * The leading token before the first separator contains the student/station info.
 */
function parseFileNameForStudent(filename: string): ParsedFolder | null {
  const nameNoExt = filename.replace(/\.[^.]+$/, '')
  // Strip underscores and uppercase, then look for the pattern at the start
  const s = nameNoExt.replace(/_/g, '').toUpperCase()
  // Match: optional P[12], then S<digit><ModuleCode><6digits>, at the start
  const m = /^(?:P\d+)?S(\d)([A-Z]{2})(\d{6})/.exec(s)
  if (!m) return null
  const moduleCode = m[2]
  return {
    stationNumber: parseInt(m[1], 10),
    moduleCode,
    shortId: m[3]
  }
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

function classifyFiles(dirPath: string): { images: string[]; conclusions: string[]; otherExts: Set<string> } {
  const images: string[] = []
  const conclusions: string[] = []
  const otherExts = new Set<string>()

  function scan(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        scan(fullPath)
      } else {
        const ext = extname(entry).toLowerCase()
        if (ext === '.pdf') {
          conclusions.push(fullPath)
        } else if (IMAGE_EXTS.has(ext)) {
          images.push(fullPath)
        } else if (ext) {
          otherExts.add(ext)
        }
      }
    }
  }

  scan(dirPath)
  images.sort((a, b) => basename(a).localeCompare(basename(b)))

  return { images, conclusions, otherExts }
}

function logEntry(
  db: Database.Database,
  runAt: string,
  sourcePath: string,
  destPath: string | null,
  status: 'success' | 'unresolved' | 'error',
  reason: string | null
): void {
  db.prepare(
    `INSERT INTO file_sort_log (run_at, source_path, dest_path, status, reason)
     VALUES (?, ?, ?, ?, ?)`
  ).run(runAt, sourcePath, destPath, status, reason)
}

function processFolder(
  db: Database.Database,
  folderPath: string,
  targetRoot: string,
  runAt: string,
  result: FileSortResult
): void {
  const folderName = basename(folderPath)
  const parsed = parseFolderName(folderName)

  if (!parsed) {
    result.unresolved.push({ source: folderPath, reason: `Cannot parse folder name "${folderName}"` })
    logEntry(db, runAt, folderPath, null, 'unresolved', `Cannot parse folder name "${folderName}"`)
    return
  }

  const { stationNumber, shortId } = parsed
  let { moduleCode } = parsed
  const resolvedModuleCode = resolveModuleAlias(db, moduleCode)
  if (!resolvedModuleCode) {
    const reason = `Module code or alias "${moduleCode}" is not configured`
    result.unresolved.push({ source: folderPath, reason })
    logEntry(db, runAt, folderPath, null, 'unresolved', reason)
    return
  }
  moduleCode = resolvedModuleCode

  // Lookup student by short ID + module code from folder name
  let student = getStudentByShortId(db, shortId, moduleCode)

  // Fallback: folder module code may be wrong — try all modules
  if (!student) {
    const matches = getStudentByShortIdAnyModule(db, shortId)
    if (matches.length === 1) {
      // Unambiguous — use the DB module code instead
      student = matches[0]
      moduleCode = matches[0].module_code
    } else if (matches.length > 1) {
      const found = matches.map((m) => `${m.module_code}(${m.student_id})`).join(', ')
      const reason = `Short ID "${shortId}" matches multiple students across modules: ${found} — cannot auto-assign`
      result.unresolved.push({ source: folderPath, reason })
      logEntry(db, runAt, folderPath, null, 'unresolved', reason)
      return
    } else {
      const reason = `Short ID "${shortId}" not found in DB for any module — student may not be imported`
      result.unresolved.push({ source: folderPath, reason })
      logEntry(db, runAt, folderPath, null, 'unresolved', reason)
      return
    }
  }

  const { images, conclusions, otherExts } = classifyFiles(folderPath)
  result.processed++

  // Flag if more than 2 images found — still copy first 2
  if (images.length > 2) {
    const reason = `${images.length} image files found (expected 2) — copied first 2 alphabetically`
    result.unresolved.push({ source: folderPath, reason })
    logEntry(db, runAt, folderPath, null, 'unresolved', reason)
  }

  if (images.length === 0) {
    const hint = otherExts.size > 0
      ? ` — folder contains: ${[...otherExts].join(', ')}`
      : ' — folder appears empty'
    const reason = `No image files found in folder${hint}`
    result.unresolved.push({ source: folderPath, reason })
    logEntry(db, runAt, folderPath, null, 'unresolved', reason)
    return
  }

  // Destination: [targetRoot]/[StudentID]/[ModuleCode]/Practical/Station [N]/
  const destDir = join(
    targetRoot,
    student.student_id,
    moduleCode,
    'Practical',
    `Station ${stationNumber}`
  )
  ensureDir(destDir)

  // Copy up to 2 images (alphabetical order = IMG1, IMG2)
  const imagesToCopy = images.slice(0, 2)
  for (const imgPath of imagesToCopy) {
    const destPath = join(destDir, basename(imgPath))
    try {
      copyFileSync(imgPath, destPath)
      logEntry(db, runAt, imgPath, destPath, 'success', null)
      result.placed++
    } catch (err) {
      const reason = `Copy failed: ${String(err)}`
      result.unresolved.push({ source: imgPath, reason })
      logEntry(db, runAt, imgPath, destPath, 'error', reason)
    }
  }

  // Copy conclusion file if present
  if (conclusions.length > 0) {
    const conclusionSrc = conclusions[0]
    const ext = extname(conclusionSrc)
    const destName = `CONCLUSION_${shortId}${ext}`
    const destPath = join(destDir, destName)
    try {
      copyFileSync(conclusionSrc, destPath)
      logEntry(db, runAt, conclusionSrc, destPath, 'success', null)
    } catch (err) {
      const reason = `Conclusion copy failed: ${String(err)}`
      result.unresolved.push({ source: conclusionSrc, reason })
      logEntry(db, runAt, conclusionSrc, destPath, 'error', reason)
    }
  }
}

function recurse(
  db: Database.Database,
  dirPath: string,
  targetRoot: string,
  runAt: string,
  result: FileSortResult
): void {
  let entries: string[]
  try {
    entries = readdirSync(dirPath)
  } catch {
    return
  }

  // Group: files whose names contain embedded student/station info
  const fileGroups = new Map<string, { parsed: ParsedFolder; images: string[]; conclusions: string[] }>()

  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      // Try to parse this directory as a student station folder
      const parsed = parseFolderName(entry)
      if (parsed) {
        processFolder(db, fullPath, targetRoot, runAt, result)
      } else {
        // Not a station folder — recurse into it
        recurse(db, fullPath, targetRoot, runAt, result)
      }
    } else {
      // File — try to extract student/station info from the file name
      const ext = extname(entry).toLowerCase()
      const isPdf = ext === '.pdf'
      const isImage = IMAGE_EXTS.has(ext)
      if (!isImage && !isPdf) continue

      const parsed = parseFileNameForStudent(entry)
      if (!parsed) continue

    const resolvedModuleCode = resolveModuleAlias(db, parsed.moduleCode)
    if (!resolvedModuleCode) {
      const reason = `Module code or alias "${parsed.moduleCode}" is not configured`
      result.unresolved.push({ source: fullPath, reason })
      logEntry(db, runAt, fullPath, null, 'unresolved', reason)
      continue
    }
    parsed.moduleCode = resolvedModuleCode
    const key = `${parsed.stationNumber}|${parsed.moduleCode}|${parsed.shortId}`
      if (!fileGroups.has(key)) {
        fileGroups.set(key, { parsed, images: [], conclusions: [] })
      }
      const group = fileGroups.get(key)!
      if (isPdf) {
        group.conclusions.push(fullPath)
      } else {
        group.images.push(fullPath)
      }
    }
  }

  // Process any file-based groups found in this directory
  for (const [, group] of fileGroups) {
    const { parsed, images, conclusions } = group
    images.sort((a, b) => basename(a).localeCompare(basename(b)))

    const student = getStudentByShortId(db, parsed.shortId, parsed.moduleCode)
    if (!student) {
      const reason = `No student found with short ID "${parsed.shortId}" for module "${parsed.moduleCode}"`
      result.unresolved.push({ source: dirPath, reason })
      logEntry(db, runAt, dirPath, null, 'unresolved', reason)
      continue
    }

    if (images.length === 0) {
      const reason = `No image files found for student ${parsed.shortId} in "${basename(dirPath)}"`
      result.unresolved.push({ source: dirPath, reason })
      logEntry(db, runAt, dirPath, null, 'unresolved', reason)
      continue
    }

    result.processed++

    const destDir = join(
      targetRoot,
      student.student_id,
      parsed.moduleCode,
      'Practical',
      `Station ${parsed.stationNumber}`
    )
    ensureDir(destDir)

    const imagesToCopy = images.slice(0, 2)
    for (const imgPath of imagesToCopy) {
      const destPath = join(destDir, basename(imgPath))
      try {
        copyFileSync(imgPath, destPath)
        logEntry(db, runAt, imgPath, destPath, 'success', null)
        result.placed++
      } catch (err) {
        const reason = `Copy failed: ${String(err)}`
        result.unresolved.push({ source: imgPath, reason })
        logEntry(db, runAt, imgPath, destPath, 'error', reason)
      }
    }

    if (conclusions.length > 0) {
      const ext = extname(conclusions[0])
      const destName = `CONCLUSION_${parsed.shortId}${ext}`
      const destPath = join(destDir, destName)
      try {
        copyFileSync(conclusions[0], destPath)
        logEntry(db, runAt, conclusions[0], destPath, 'success', null)
      } catch (err) {
        const reason = `Conclusion copy failed: ${String(err)}`
        result.unresolved.push({ source: conclusions[0], reason })
        logEntry(db, runAt, conclusions[0], destPath, 'error', reason)
      }
    }
  }
}

/**
 * Check whether a properly-named CONCLUSION_ file already exists in a station directory.
 */
function hasExistingConclusion(dir: string): boolean {
  if (!existsSync(dir)) return false
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return false
  }
  return entries.some((f) => f.toLowerCase().startsWith('conclusion_'))
}

interface FoundFormFile {
  filePath: string
  studentId: string
  moduleCode: string
}

/**
 * Recursively scan assessmentRoot for any file whose name contains "Form"
 * (e.g. "100114827 Form E4.jpg", "100169691 Form E2.jpg").
 * Derives studentId and moduleCode from the folder path:
 *   [assessmentRoot]/[studentId]/[moduleCode]/(...)/file
 * Station number is NOT derived from the path — it comes from the module config.
 */
function collectFormFiles(dir: string, assessmentRoot: string): FoundFormFile[] {
  const results: FoundFormFile[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      results.push(...collectFormFiles(fullPath, assessmentRoot))
    } else if (/form/i.test(entry)) {
      const rel = fullPath.slice(assessmentRoot.length).replace(/^[/\\]/, '')
      const parts = rel.split(/[/\\]/)
      // Need at least: studentId / moduleCode / file
      if (parts.length < 3) continue
      const studentId = parts[0]
      const moduleCode = parts[1].toUpperCase()
      results.push({ filePath: fullPath, studentId, moduleCode })
    }
  }

  return results
}

/**
 * Scan the entire assessmentRoot for conclusion forms (any file whose name
 * contains "Form"), derive student/module from the folder path, map the module
 * to its conclusion station(s) via conclusionStations, then copy into the
 * correct target station directories named CONCLUSION_[shortId].[ext].
 *
 * conclusionStations: map of moduleCode → station numbers that have conclusions
 * e.g. { FC: [4], AS: [8], PR: [4] }
 */
export function runFindConclusions(
  db: Database.Database,
  assessmentRoot: string,
  targetRoot: string,
  conclusionStations: Record<string, number[]>
): FileSortResult {
  const result: FileSortResult = { processed: 0, placed: 0, unresolved: [] }
  const runAt = new Date().toISOString()

  const formFiles = collectFormFiles(assessmentRoot, assessmentRoot)

  for (const { filePath, studentId, moduleCode } of formFiles) {
    const stations = conclusionStations[moduleCode]
    if (!stations || stations.length === 0) {
      // Module doesn't have a conclusion station — skip silently
      continue
    }

    // Verify this student/module exists in the DB
    const student = db
      .prepare('SELECT student_id FROM students WHERE student_id = ? AND module_code = ?')
      .get(studentId, moduleCode) as { student_id: string } | undefined

    if (!student) {
      result.processed++
      const reason = `No student in DB for ID "${studentId}" module "${moduleCode}"`
      result.unresolved.push({ source: filePath, reason })
      logEntry(db, runAt, filePath, null, 'unresolved', reason)
      continue
    }

    const shortId = studentId.slice(-6)

    for (const stationNumber of stations) {
      result.processed++

      const destDir = join(targetRoot, studentId, moduleCode, 'Practical', `Station ${stationNumber}`)

      // If the form file already lives inside destDir, no copy needed
      if (resolve(destDir) === resolve(dirname(filePath))) {
        result.placed++
        logEntry(db, runAt, filePath, filePath, 'success', 'already in target directory')
        continue
      }

      // Skip if a CONCLUSION_ file already exists in the target
      if (hasExistingConclusion(destDir)) {
        result.placed++
        continue
      }

      ensureDir(destDir)
      const ext = extname(filePath)
      const destPath = join(destDir, `CONCLUSION_${shortId}${ext}`)

      try {
        copyFileSync(filePath, destPath)
        logEntry(db, runAt, filePath, destPath, 'success', null)
        result.placed++
      } catch (err) {
        const reason = `Copy failed: ${String(err)}`
        result.unresolved.push({ source: filePath, reason })
        logEntry(db, runAt, filePath, destPath, 'error', reason)
      }
    }
  }

  return result
}

export function runFileSort(
  db: Database.Database,
  sourcePath: string,
  targetRoot: string
): FileSortResult {
  const result: FileSortResult = { processed: 0, placed: 0, unresolved: [] }
  const runAt = new Date().toISOString()
  recurse(db, sourcePath, targetRoot, runAt, result)
  return result
}
