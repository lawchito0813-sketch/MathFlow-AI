import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

function runPython(scriptPath, workingDirectory) {
  return new Promise(resolve => {
    const child = spawn('python3', [scriptPath], {
      cwd: workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })

    child.on('close', code => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      })
    })
  })
}

function getFigureSize(canvasType) {
  if (canvasType === 'portrait') {
    return [6, 8]
  }

  if (canvasType === 'landscape') {
    return [8, 6]
  }

  if (canvasType === 'wide') {
    return [10, 5.6]
  }

  return [6.4, 6.4]
}

function normalizePythonCode(pythonCode) {
  return pythonCode
    .replaceAll("'__OUTPUT_IMAGE_PATH__'", '__OUTPUT_IMAGE_PATH__')
    .replaceAll('"__OUTPUT_IMAGE_PATH__"', '__OUTPUT_IMAGE_PATH__')
    .replaceAll("'__FIGSIZE__'", '__FIGSIZE__')
    .replaceAll('"__FIGSIZE__"', '__FIGSIZE__')
}

function validatePythonCode(pythonCode) {
  if (!pythonCode.includes('__OUTPUT_IMAGE_PATH__')) {
    return 'Python 程式缺少 __OUTPUT_IMAGE_PATH__ 常量。'
  }

  if (!pythonCode.includes('__FIGSIZE__')) {
    return 'Python 程式缺少 __FIGSIZE__ 常量。'
  }

  if (/figsize\s*=\s*\((?!\s*__FIGSIZE__\s*\))/m.test(pythonCode)) {
    return 'Python 程式不可硬編 figsize，必須使用 __FIGSIZE__。'
  }

  if (/\.tight_layout\s*\(/m.test(pythonCode) || /\btight_layout\s*\(/m.test(pythonCode)) {
    return 'Python 程式不可使用 tight_layout()。'
  }

  if (/ax\.text\([^\n]*(由|所以|可得|因此|證明|证明|答案|解|步驟|步骤|內角和|内角和|SAS|ASA|AAS|SSS|代入)[^\n]*\)/m.test(pythonCode)) {
    return 'Python 圖上標註不可包含解題過程或結論文字。'
  }

  if (/plt\.text\([^\n]*(由|所以|可得|因此|證明|证明|答案|解|步驟|步骤|內角和|内角和|SAS|ASA|AAS|SSS|代入)[^\n]*\)/m.test(pythonCode)) {
    return 'Python 圖上標註不可包含解題過程或結論文字。'
  }

  return null
}

export async function executePythonDiagram({ pythonCode, canvasType = 'square' }) {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'math-diagram-'))
  const imageFileName = `${randomUUID()}.jpg`
  const imagePath = join(workingDirectory, imageFileName)
  const scriptPath = join(workingDirectory, 'diagram.py')
  const figureSize = getFigureSize(canvasType)

  const normalizedCode = normalizePythonCode(pythonCode)
  const validationError = validatePythonCode(normalizedCode)
  if (validationError) {
    return {
      ok: false,
      error: validationError
    }
  }

  const script = normalizedCode
    .replaceAll('__OUTPUT_IMAGE_PATH__', JSON.stringify(imagePath))
    .replaceAll('__FIGSIZE__', JSON.stringify(figureSize))
  await writeFile(scriptPath, script, 'utf8')

  try {
    const result = await runPython(scriptPath, workingDirectory)

    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: [result.stderr, result.stdout].filter(Boolean).join('\n').trim() || `Python 執行失敗，exit code=${result.exitCode}`
      }
    }

    let imageStats = null
    try {
      imageStats = await stat(imagePath)
    } catch {
      imageStats = null
    }

    if (!imageStats || imageStats.size === 0) {
      return {
        ok: false,
        error: 'Python 執行完成，但未生成有效 JPG 圖片。'
      }
    }

    const imageBuffer = await readFile(imagePath)
    return {
      ok: true,
      imageDataUrl: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}
