import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function getCropRect(regionHint = '') {
  const hint = String(regionHint || '').trim().toLowerCase()
  if (hint === 'upper' || hint === 'top-half') {
    return { x: 0, y: 0, widthPercent: 100, heightPercent: 44 }
  }
  if (hint === 'lower' || hint === 'bottom-half') {
    return { x: 0, y: 56, widthPercent: 100, heightPercent: 44 }
  }
  return null
}

export async function cropPageImage({ imagePath, regionHint, pageNumber }) {
  const rect = getCropRect(regionHint)
  if (!rect) {
    return null
  }

  const workDir = join(tmpdir(), `paper-crop-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const outputPath = join(workDir, `page-${pageNumber || 'x'}-${regionHint}.png`)
  const cropArg = `${rect.widthPercent}x${rect.heightPercent}%+${rect.x}%+${rect.y}%`

  await execFileAsync('sips', ['-c', cropArg, imagePath, '--out', outputPath], {
    maxBuffer: 10 * 1024 * 1024
  })

  const buffer = await fs.readFile(outputPath)
  return {
    imagePath: outputPath,
    imageBase64: buffer.toString('base64'),
    mediaType: 'image/png'
  }
}
