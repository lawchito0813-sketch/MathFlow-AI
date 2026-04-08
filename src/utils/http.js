import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  })
  res.end(JSON.stringify(data))
}

export function sendNotFound(res) {
  sendJson(res, 404, { error: '找不到對應路由' })
}

export function sendMethodNotAllowed(res) {
  sendJson(res, 405, { error: '不支援的請求方法' })
}

export async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export async function readMultipartPdfUpload(req) {
  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(?:(?:")?([^";]+)(?:")?)/i)
  if (!boundaryMatch) {
    throw new Error('缺少 multipart boundary')
  }

  const boundary = `--${boundaryMatch[1]}`
  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const body = Buffer.concat(chunks)
  const bodyBinary = body.toString('binary')

  const tempDir = await mkdtemp(join(tmpdir(), 'paper-review-'))
  const fields = {}

  let filePath = ''
  let fileName = ''
  let cursor = 0
  while (cursor < bodyBinary.length) {
    const boundaryIndex = bodyBinary.indexOf(boundary, cursor)
    if (boundaryIndex === -1) break

    const isFinalBoundary = bodyBinary.slice(boundaryIndex, boundaryIndex + boundary.length + 4) === `${boundary}--\r\n`
    if (isFinalBoundary) break

    const headerStart = boundaryIndex + boundary.length + 2
    const headerEnd = bodyBinary.indexOf('\r\n\r\n', headerStart)
    if (headerEnd === -1) break

    const rawHeaders = bodyBinary.slice(headerStart, headerEnd)
    const nameMatch = rawHeaders.match(/name="([^"]+)"/)
    const fieldName = nameMatch?.[1] || ''
    const filenameMatch = rawHeaders.match(/filename="([^"]+)"/)
    const dataStart = headerEnd + 4
    const nextBoundaryBinary = `\r\n${boundary}`
    const dataEnd = bodyBinary.indexOf(nextBoundaryBinary, dataStart)
    if (dataEnd === -1) break

    if (filenameMatch) {
      const originalFileName = filenameMatch[1] || 'paper.pdf'
      if (fieldName !== 'pdf') {
        cursor = dataEnd + 2
        continue
      }
      if (extname(originalFileName).toLowerCase() !== '.pdf') {
        throw new Error('只支援 PDF 檔案')
      }

      const fileBuffer = body.subarray(dataStart, dataEnd)
      if (!fileBuffer.length) {
        throw new Error('上傳的 PDF 為空')
      }

      const safeName = `${randomUUID()}-${originalFileName.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
      filePath = join(tempDir, safeName)
      fileName = originalFileName

      await new Promise((resolve, reject) => {
        const stream = createWriteStream(filePath)
        stream.on('error', reject)
        stream.on('finish', resolve)
        stream.end(fileBuffer)
      })
    } else if (fieldName) {
      fields[fieldName] = body.slice(dataStart, dataEnd).toString('utf8')
    }

    cursor = dataEnd + 2
  }

  if (!filePath) {
    throw new Error('缺少 PDF 檔案欄位')
  }

  return {
    filePath,
    fileName,
    fields,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}
