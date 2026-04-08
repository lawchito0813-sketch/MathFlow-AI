import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PAPER_INDEX_POINT_TO_PIXEL_SCALE = 0.75
const REVIEW_TARGET_DPI = 300
const PDF_POINTS_PER_INCH = 72
const REVIEW_POINT_TO_PIXEL_SCALE = REVIEW_TARGET_DPI / PDF_POINTS_PER_INCH

function parsePdfInfoDimensions(stdout = '') {
  const mediaBoxMatch = stdout.match(/MediaBox:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i)
  if (!mediaBoxMatch) return null

  const left = Number(mediaBoxMatch[1])
  const top = Number(mediaBoxMatch[2])
  const right = Number(mediaBoxMatch[3])
  const bottom = Number(mediaBoxMatch[4])

  if (![left, top, right, bottom].every(Number.isFinite)) return null

  const widthPoints = Math.max(0, right - left)
  const heightPoints = Math.max(0, bottom - top)
  if (widthPoints <= 0 || heightPoints <= 0) return null

  return { widthPoints, heightPoints }
}

async function getPdfPageDimensions(pdfPath) {
  const { stdout } = await execFileAsync('pdfinfo', ['-box', pdfPath], {
    maxBuffer: 10 * 1024 * 1024
  })
  return parsePdfInfoDimensions(stdout)
}

export async function renderPdfToImages(pdfPath) {
  const workDir = join(tmpdir(), `paper-review-${randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })

  const pdfDimensions = await getPdfPageDimensions(pdfPath)
  const paperIndexPrefix = join(workDir, 'page')
  const reviewPrefix = join(workDir, 'page-review')
  const paperIndexArgs = ['-png', '-cropbox']
  const reviewArgs = ['-png', '-cropbox']

  const paperIndexWidth = pdfDimensions ? Math.max(1, Math.round(pdfDimensions.widthPoints * PAPER_INDEX_POINT_TO_PIXEL_SCALE)) : null
  const paperIndexHeight = pdfDimensions ? Math.max(1, Math.round(pdfDimensions.heightPoints * PAPER_INDEX_POINT_TO_PIXEL_SCALE)) : null
  const reviewWidth = pdfDimensions ? Math.max(1, Math.round(pdfDimensions.widthPoints * REVIEW_POINT_TO_PIXEL_SCALE)) : null
  const reviewHeight = pdfDimensions ? Math.max(1, Math.round(pdfDimensions.heightPoints * REVIEW_POINT_TO_PIXEL_SCALE)) : null

  if (pdfDimensions) {
    paperIndexArgs.push(
      '-scale-to-x', String(Math.max(1, paperIndexWidth)),
      '-scale-to-y', String(Math.max(1, paperIndexHeight))
    )
    reviewArgs.push(
      '-scale-to-x', String(Math.max(1, reviewWidth)),
      '-scale-to-y', String(Math.max(1, reviewHeight))
    )
  }

  paperIndexArgs.push(pdfPath, paperIndexPrefix)
  reviewArgs.push(pdfPath, reviewPrefix)

  await execFileAsync('pdftoppm', paperIndexArgs, {
    maxBuffer: 10 * 1024 * 1024
  })

  await execFileAsync('pdftoppm', reviewArgs, {
    maxBuffer: 10 * 1024 * 1024
  })

  const files = (await fs.readdir(workDir))
    .filter(name => /^page-\d+\.png$/.test(name))
    .sort((a, b) => {
      const ai = Number(a.match(/page-(\d+)\.png/)?.[1] || 0)
      const bi = Number(b.match(/page-(\d+)\.png/)?.[1] || 0)
      return ai - bi
    })

  const pages = await Promise.all(files.map(async (name) => {
    const filePath = join(workDir, name)
    const pageNumber = Number(name.match(/page-(\d+)\.png/)?.[1] || 0)
    const reviewPath = join(workDir, `page-review-${String(pageNumber).padStart(2, '0')}.png`)
    const data = await fs.readFile(filePath)
    const reviewData = await fs.readFile(reviewPath)
    return {
      pageNumber,
      imagePath: filePath,
      imageBase64: data.toString('base64'),
      reviewImagePath: reviewPath,
      reviewImageBase64: reviewData.toString('base64'),
      mediaType: 'image/png',
      renderWidth: paperIndexWidth,
      renderHeight: paperIndexHeight,
      reviewRenderWidth: reviewWidth,
      reviewRenderHeight: reviewHeight,
      sourceWidthPoints: pdfDimensions?.widthPoints || null,
      sourceHeightPoints: pdfDimensions?.heightPoints || null,
      renderMode: pdfDimensions ? 'cropbox-native-points' : 'pdftoppm-default',
      reviewRenderMode: pdfDimensions ? 'cropbox-300dpi-review' : 'pdftoppm-default-review'
    }
  }))

  return {
    workDir,
    pages,
    render: {
      mode: pdfDimensions ? 'cropbox-native-points' : 'pdftoppm-default',
      widthPoints: pdfDimensions?.widthPoints || null,
      heightPoints: pdfDimensions?.heightPoints || null,
      scaleFactor: PAPER_INDEX_POINT_TO_PIXEL_SCALE,
      reviewScaleFactor: REVIEW_POINT_TO_PIXEL_SCALE,
      reviewTargetDpi: REVIEW_TARGET_DPI,
      reviewWidth,
      reviewHeight
    }
  }
}
