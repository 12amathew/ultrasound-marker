import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, extname, basename } from 'path'

const IMAGE_EXTS = new Set(['.tif', '.tiff', '.jpg', '.jpeg', '.png'])
const REF_IMAGE_EXTS = new Set(['.tif', '.tiff', '.jpg', '.jpeg', '.png'])

/**
 * Find the two student image files in a station folder.
 * Files are ordered alphabetically — first = IMG1, second = IMG2.
 */
export function getStudentImages(
  targetRoot: string,
  student_id: string,
  module_code: string,
  station_number: number
): { img1Path: string | null; img2Path: string | null; conclusionPath: string | null } {
  const stationDir = join(targetRoot, student_id, module_code, 'Practical', `Station ${station_number}`)

  if (!existsSync(stationDir)) {
    return { img1Path: null, img2Path: null, conclusionPath: null }
  }

  const entries = readdirSync(stationDir)
  const images: string[] = []
  let conclusionPath: string | null = null

  for (const entry of entries) {
    const fullPath = join(stationDir, entry)
    const ext = extname(entry).toLowerCase()
    const nameLower = entry.toLowerCase()

    if (nameLower.startsWith('conclusion_')) {
      conclusionPath = fullPath
    } else if (/form/i.test(entry)) {
      // Form files (e.g. "100114827 Form E4.jpg") are conclusions, not images
      if (!conclusionPath) conclusionPath = fullPath
    } else if (IMAGE_EXTS.has(ext)) {
      images.push(fullPath)
    } else if (ext === '.pdf') {
      if (!conclusionPath) conclusionPath = fullPath
    }
  }

  images.sort((a, b) => basename(a).localeCompare(basename(b)))

  return {
    img1Path: images[0] ?? null,
    img2Path: images[1] ?? null,
    conclusionPath
  }
}

/**
 * Find reference images for a given module + station.
 * Naming: REF_[ModuleCode]_S[StationNumber]_IMG[1|2].[ext]
 */
export function getReferenceImages(
  refImagesRoot: string,
  module_code: string,
  station_number: number
): { img1Path: string | null; img2Path: string | null } {
  if (!existsSync(refImagesRoot)) {
    return { img1Path: null, img2Path: null }
  }

  const entries = readdirSync(refImagesRoot)
  let img1Path: string | null = null
  let img2Path: string | null = null

  const prefix1 = `REF_${module_code}_S${station_number}_IMG1`.toUpperCase()
  const prefix2 = `REF_${module_code}_S${station_number}_IMG2`.toUpperCase()

  for (const entry of entries) {
    // Normalise dashes to underscores so REF_AS-S8_IMG1 matches REF_AS_S8_IMG1
    const nameNoExt = entry.toUpperCase().replace(/\.[^.]+$/, '').replace(/-/g, '_')
    const ext = extname(entry).toLowerCase()
    if (!REF_IMAGE_EXTS.has(ext)) continue

    if (nameNoExt === prefix1) img1Path = join(refImagesRoot, entry)
    else if (nameNoExt === prefix2) img2Path = join(refImagesRoot, entry)
  }

  return { img1Path, img2Path }
}

/**
 * Read a file and return it as a base64 data URL.
 * Used to send image data to the renderer via IPC.
 */
export function readFileAsBase64(filePath: string): string {
  if (!existsSync(filePath)) return ''
  try {
    const buffer = readFileSync(filePath)
    const ext = extname(filePath).toLowerCase()
    let mime = 'application/octet-stream'
    if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg'
    else if (ext === '.tif' || ext === '.tiff') mime = 'image/tiff'
    else if (ext === '.png') mime = 'image/png'
    else if (ext === '.pdf') mime = 'application/pdf'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch {
    return ''
  }
}
