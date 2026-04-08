import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runDiagramFlow, runPaperReviewFlow, runReviewFlow, runReviewFollowupFlow, runSolveFlow } from '../core/orchestrator.js'
import { runDseAuthorRevalidateFlow } from '../core/dse-author-flow.js'
import { runDseAgentFlow, runDseAgentFollowupFlow, runDseAgentRevalidateFlow } from '../core/dse-agent-runtime.js'
import { getSession, getAllSessions, getSessionDebugLog, setSession } from '../core/session-store.js'
import {
  validateDseAuthorFollowupRequest,
  validateDseAuthorRequest,
  validateDseAuthorRevalidateRequest,
  validateReviewFollowupRequest,
  validateReviewRequest,
  validateSolveRequest
} from '../schemas/index.js'
import { listModelPresets } from '../model/config.js'
import { requestModel } from '../model/client.js'
import { readJsonBody, readMultipartPdfUpload, sendJson, sendMethodNotAllowed, sendNotFound } from '../utils/http.js'
import { createEvent, SESSION_EVENT_TYPES } from '../utils/events.js'
import { initSse, sendSseEvent } from './sse.js'

const PUBLIC_FILES = {
  '/': 'index.html',
  '/simple': 'simple.html',
  '/review': 'review.html',
  '/paper-review': 'paper-review.html',
  '/review-simple': 'review-simple.html',
  '/dse-author': 'dse-author.html',
  '/app.js': 'app.js',
  '/simple-app.js': 'simple-app.js',
  '/review-app.js': 'review-app.js',
  '/review-simple-app.js': 'review-simple-app.js',
  '/paper-review-app.js': 'paper-review-app.js',
  '/dse-author-app.js': 'dse-author-app.js',
  '/styles.css': 'styles.css',
  '/katex.min.css': 'katex.min.css',
  '/katex.min.js': 'katex.min.js',
  '/auto-render.min.js': 'auto-render.min.js',
  '/favicon.ico': null
}

function getContentType(filePath) {
  const extension = extname(filePath)
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'application/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  return 'application/octet-stream'
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const fileName = PUBLIC_FILES[pathname]

  if (fileName === null) {
    res.writeHead(204)
    res.end()
    return
  }

  if (!fileName) {
    sendNotFound(res)
    return
  }

  const fileUrl = new URL(`../../public/${fileName}`, import.meta.url)

  try {
    const content = await readFile(fileUrl)
    res.writeHead(200, { 'content-type': getContentType(fileUrl.pathname) })
    res.end(content)
  } catch {
    sendNotFound(res)
  }
}

function handleEvents(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res)

  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId')?.trim()
  if (!sessionId) {
    return sendJson(res, 400, { error: '缺少 sessionId' })
  }

  initSse(res)

  const sessions = globalThis.__MATH_SESSION_EMITTERS__
  const emitter = event => {
    try {
      sendSseEvent(res, event)
    } catch {
      sessions.delete(sessionId)
    }
  }

  sessions.set(sessionId, emitter)
  emitter(createEvent('session_created', { sessionId }))

  req.on('close', () => {
    if (sessions.get(sessionId) === emitter) {
      sessions.delete(sessionId)
    }
  })
}

async function handleSolve(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const input = validateSolveRequest(body)
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
      ? body.sessionId.trim()
      : randomUUID()

    sendJson(res, 200, { sessionId })

    process.nextTick(async () => {
      const events = globalThis.__MATH_SESSION_EMITTERS__
      const emitter = events.get(sessionId)
      if (!emitter) return

      try {
        await runSolveFlow({
          sessionId,
          input,
          providerId,
          emit: event => emitter(event)
        })
      } catch (error) {
        emitter(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
          message: error instanceof Error ? error.message : '解題流程失敗'
        }))
      }
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '請求格式錯誤'
    })
  }
}

async function handleReview(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const input = validateReviewRequest(body)
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
      ? body.sessionId.trim()
      : randomUUID()

    sendJson(res, 200, { sessionId })

    process.nextTick(async () => {
      const events = globalThis.__MATH_SESSION_EMITTERS__
      const emitter = events.get(sessionId)
      if (!emitter) return

      try {
        await runReviewFlow({
          sessionId,
          input,
          providerId,
          emit: event => emitter(event)
        })
      } catch (error) {
        emitter(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
          message: error instanceof Error ? error.message : '批改流程失敗'
        }))
      }
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '請求格式錯誤'
    })
  }
}

async function handleReviewFollowup(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const { sessionId, question } = validateReviewFollowupRequest(body)
    const session = getSession(sessionId)

    if (!session || session.flowType !== 'review') {
      return sendJson(res, 404, { error: '找不到對應批改會話' })
    }

    const emitter = globalThis.__MATH_SESSION_EMITTERS__.get(sessionId)
    if (!emitter) {
      return sendJson(res, 409, { error: '請先建立事件連線' })
    }

    sendJson(res, 200, { sessionId })

    process.nextTick(async () => {
      try {
        await runReviewFollowupFlow({
          session,
          question,
          emit: event => emitter(event)
        })
      } catch (error) {
        emitter(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
          message: error instanceof Error ? error.message : '追問流程失敗'
        }))
      }
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '請求格式錯誤'
    })
  }
}

async function handlePaperReview(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  let cleanupUpload = null

  try {
    const contentType = req.headers['content-type'] || ''
    let pdfPath = ''
    let providerId = ''
    let sessionId = ''

    if (contentType.includes('multipart/form-data')) {
      const upload = await readMultipartPdfUpload(req)
      cleanupUpload = upload.cleanup
      pdfPath = upload.filePath
      providerId = typeof upload.fields.providerId === 'string' ? upload.fields.providerId.trim() : ''
      sessionId = typeof upload.fields.sessionId === 'string' && upload.fields.sessionId.trim()
        ? upload.fields.sessionId.trim()
        : randomUUID()
    } else {
      const body = await readJsonBody(req)
      pdfPath = typeof body.pdfPath === 'string' ? body.pdfPath.trim() : ''
      providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
      sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : randomUUID()
    }

    if (!pdfPath) {
      if (cleanupUpload) await cleanupUpload()
      return sendJson(res, 400, { error: '缺少 pdfPath 或 PDF 檔案' })
    }

    sendJson(res, 200, { sessionId })

    setSession(sessionId, {
      sessionId,
      flowType: 'paper-review',
      providerId,
      pdfPath,
      paperIndex: null,
      questions: [],
      questionResults: [],
      report: '',
      reportPending: true,
      status: 'accepted',
      startedAt: new Date().toISOString()
    })

    const startFlow = async () => {
      const events = globalThis.__MATH_SESSION_EMITTERS__
      const emit = event => {
        const emitter = events.get(sessionId)
        if (!emitter) return
        emitter(event)
      }

      try {
        await runPaperReviewFlow({
          sessionId,
          pdfPath,
          providerId,
          emit
        })
      } catch (error) {
        console.error('[paper-review]', sessionId, error)
        emit(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
          message: error instanceof Error ? error.message : '整卷批改流程失敗'
        }))
      } finally {
        const currentSession = getSession(sessionId)
        if (!currentSession) {
          setSession(sessionId, {
            sessionId,
            flowType: 'paper-review',
            providerId,
            pdfPath,
            paperIndex: null,
            questions: [],
            questionResults: [],
            report: '',
            reportPending: true,
            error: 'session_lost'
          })
        }
        if (cleanupUpload) await cleanupUpload()
      }
    }

    setTimeout(startFlow, 0)
  } catch (error) {
    if (cleanupUpload) await cleanupUpload()
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '請求格式錯誤'
    })
  }
}


async function handlePaperReviewDebug(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res)

  const sessions = Array.from(getAllSessions().entries()).map(([sessionId, session]) => ({
    sessionId,
    flowType: session?.flowType || '',
    reportPending: Boolean(session?.reportPending),
    questionResults: Array.isArray(session?.questionResults) ? session.questionResults.length : 0,
    error: session?.error || null
  }))

  return sendJson(res, 200, {
    pid: process.pid,
    sessions,
    debug: getSessionDebugLog().slice(-50)
  })
}

function projectPaperReviewSession(session) {
  if (!session || session.flowType !== 'paper-review') return null

  const questionResults = Array.isArray(session.questionResults) ? session.questionResults : []
  const questionsCompleted = questionResults.length > 0 && questionResults.every(result => result?.status === 'completed' || result?.status === 'failed')

  return {
    sessionId: session.sessionId,
    flowType: session.flowType,
    providerId: session.providerId,
    pdfPath: session.pdfPath,
    paperIndex: session.paperIndex || null,
    questionsCompleted,
    questions: Array.isArray(session.questions)
      ? session.questions.map(question => ({
          ...question,
          pages: Array.isArray(question.pages)
            ? question.pages.map(page => ({
                pageNumber: page.pageNumber,
                mediaType: page.mediaType,
                hasImageBase64: Boolean(page.imageBase64)
              }))
            : []
        }))
      : [],
    questionResults: questionResults
      ? questionResults.map(result => ({
          ...result,
          pages: Array.isArray(result.pages)
            ? result.pages.map(page => ({
                pageNumber: page.pageNumber,
                mediaType: page.mediaType,
                hasImageBase64: Boolean(page.imageBase64),
                cropApplied: Boolean(page.cropApplied),
                cropFallback: Boolean(page.cropFallback),
                cropRegionHint: page.cropRegionHint || ''
              }))
            : []
        }))
      : [],
    report: session.report || '',
    reportPending: Boolean(session.reportPending),
    phaseTimings: Array.isArray(session.phaseTimings) ? session.phaseTimings : [],
    groupTimings: Array.isArray(session.groupTimings) ? session.groupTimings : []
  }
}

function projectDseAuthorSession(session) {
  if (!session || session.flowType !== 'dse-author') return null

  return {
    sessionId: session.sessionId,
    flowType: session.flowType,
    providerId: session.providerId,
    intent: session.intent || null,
    blueprint: session.blueprint || null,
    generatedQuestions: Array.isArray(session.generatedQuestions)
      ? session.generatedQuestions.map(item => ({
          questionNumber: item.questionNumber,
          title: item.title,
          paperSection: item.paperSection,
          questionType: item.questionType,
          difficultyBand: item.difficultyBand,
          topicTags: item.topicTags || [],
          questionTextZh: item.questionTextZh || '',
          questionTextEn: item.questionTextEn || '',
          options: item.options || [],
          answer: item.answer || '',
          working: item.working || '',
          markingScheme: item.markingScheme || '',
          marks: item.marks || 0,
          needsDiagram: item.needsDiagram || 'optional',
          diagramInstructions: item.diagramInstructions || '',
          draftText: item.draftText || '',
          solutionText: item.solutionText || '',
          parserWarnings: item.parserWarnings || [],
          mergeStatus: item.mergeStatus || '',
          diagramPlan: item.diagramPlan || null,
          diagramImage: item.diagramImage || null,
          verification: item.verification || null,
          markAssessment: item.markAssessment || null
        }))
      : [],
    questionTasks: Array.isArray(session.questionTasks) ? session.questionTasks : [],
    paper: session.paper || null,
    exportArtifact: session.exportArtifact || null,
    followupMessages: Array.isArray(session.followupMessages) ? session.followupMessages : [],
    finalExplanation: session.finalExplanation || '',
    diagramImage: session.diagramImage || null,
    messages: Array.isArray(session.messages) ? session.messages : [],
    toolCalls: Array.isArray(session.toolCalls) ? session.toolCalls : [],
    verificationHistory: Array.isArray(session.verificationHistory) ? session.verificationHistory : [],
    diagramHistory: Array.isArray(session.diagramHistory) ? session.diagramHistory : [],
    agentState: session.agentState || {}
  }
}

async function handlePaperReviewSession(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res)

  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId')?.trim()
  if (!sessionId) {
    return sendJson(res, 400, { error: '缺少 sessionId' })
  }

  const session = getSession(sessionId)
  if (!session || session.flowType !== 'paper-review') {
    return sendJson(res, 404, { error: '找不到對應整卷批改會話' })
  }

  return sendJson(res, 200, projectPaperReviewSession(session))
}

async function handleProviders(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res)
  sendJson(res, 200, listModelPresets())
}

async function handleDebugRequestModel(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const response = await requestModel({
      providerId: typeof body.providerId === 'string' ? body.providerId.trim() : '',
      system: typeof body.system === 'string' ? body.system : '',
      user: typeof body.user === 'string' ? body.user : '',
      userContent: body.userContent,
      stream: Boolean(body.stream),
      maxCompletionTokens: typeof body.maxCompletionTokens === 'number' ? body.maxCompletionTokens : 800
    })
    sendJson(res, 200, { ok: true, text: response.text || '' })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

async function handleDseAuthorGenerate(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const request = validateDseAuthorRequest(body)
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : 'api1'
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
      ? body.sessionId.trim()
      : randomUUID()

    sendJson(res, 200, { sessionId })

    process.nextTick(async () => {
      const events = globalThis.__MATH_SESSION_EMITTERS__
      const emitter = events.get(sessionId)
      if (!emitter) return

      try {
        await runDseAgentFlow({
          sessionId,
          request,
          providerId,
          emit: event => emitter(event),
          getSession,
          setSession
        })
      } catch (error) {
        console.error('[dse-author]', sessionId, error)
        emitter(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
          message: error instanceof Error ? error.message : 'DSE 出題流程失敗'
        }))
      }
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '請求格式錯誤'
    })
  }
}

async function handleDseAuthorFollowup(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const { sessionId, message } = validateDseAuthorFollowupRequest(body)
    const session = getSession(sessionId)

    if (!session || session.flowType !== 'dse-author') {
      return sendJson(res, 404, { error: '找不到對應出題會話' })
    }

    const emitter = globalThis.__MATH_SESSION_EMITTERS__.get(sessionId)
    if (!emitter) {
      return sendJson(res, 409, { error: '請先建立事件連線' })
    }

    sendJson(res, 200, { sessionId })

    process.nextTick(async () => {
      try {
        await runDseAgentFollowupFlow({
          session,
          message,
          emit: event => emitter(event),
          setSession: (id, value) => setSession(id, value)
        })
      } catch (error) {
        emitter(createEvent(SESSION_EVENT_TYPES.SESSION_ERROR, {
          message: error instanceof Error ? error.message : '出題追問流程失敗'
        }))
      }
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '請求格式錯誤'
    })
  }
}

async function handleDseAuthorRevalidate(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const { sessionId, draft } = validateDseAuthorRevalidateRequest(body)
    const session = getSession(sessionId)

    if (!session || session.flowType !== 'dse-author') {
      return sendJson(res, 404, { error: '找不到對應出題會話' })
    }

    const emitter = globalThis.__MATH_SESSION_EMITTERS__.get(sessionId)
    if (!emitter) {
      return sendJson(res, 409, { error: '請先建立事件連線' })
    }

    const updatedSession = await runDseAgentRevalidateFlow({
      session,
      draft,
      emit: event => emitter(event),
      setSession: (id, value) => setSession(id, value)
    })

    sendJson(res, 200, {
      sessionId,
      generatedQuestions: updatedSession.generatedQuestions || []
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '再次驗算失敗'
    })
  }
}

async function handleDseAuthorSession(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res)

  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId')?.trim()
  if (!sessionId) {
    return sendJson(res, 400, { error: '缺少 sessionId' })
  }

  const session = getSession(sessionId)
  if (!session) {
    return sendJson(res, 404, {
      error: '找不到對應出題會話',
      debug: globalThis.__MATH_SESSION_DEBUG__ || [],
      verifyDebug: globalThis.__DSE_VERIFY_DEBUG__ || [],
      requestModelDebug: globalThis.__REQUEST_MODEL_DEBUG__ || []
    })
  }

  return sendJson(res, 200, projectDseAuthorSession({
    sessionId,
    flowType: 'dse-author',
    ...session
  }))
}

async function handleDiagram(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res)

  try {
    const body = await readJsonBody(req)
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''

    if (!sessionId) {
      return sendJson(res, 400, { error: '缺少 sessionId' })
    }

    const session = getSession(sessionId)
    if (!session) {
      return sendJson(res, 404, { error: '找不到對應會話' })
    }

    const emitter = globalThis.__MATH_SESSION_EMITTERS__.get(sessionId)
    if (!emitter) {
      return sendJson(res, 409, { error: '請先建立事件連線' })
    }

    const updatedSession = await runDiagramFlow({
      session,
      emit: event => emitter(event)
    })

    sendJson(res, 200, {
      sessionId,
      imageDataUrl: updatedSession.diagramImage
    })
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : '作圖流程失敗'
    })
  }
}

export async function routeRequest(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname

  if (pathname === '/api/solve') return handleSolve(req, res)
  if (pathname === '/api/review') return handleReview(req, res)
  if (pathname === '/api/review/followup') return handleReviewFollowup(req, res)
  if (pathname === '/api/paper-review') return handlePaperReview(req, res)
  if (pathname === '/api/paper-review-session') return handlePaperReviewSession(req, res)
  if (pathname === '/api/debug/paper-review-sessions') return handlePaperReviewDebug(req, res)
  if (pathname === '/api/dse-author/generate') return handleDseAuthorGenerate(req, res)
  if (pathname === '/api/dse-author/followup') return handleDseAuthorFollowup(req, res)
  if (pathname === '/api/dse-author/revalidate') return handleDseAuthorRevalidate(req, res)
  if (pathname === '/api/dse-author/session') return handleDseAuthorSession(req, res)
  if (pathname === '/api/debug-request-model') return handleDebugRequestModel(req, res)
  if (pathname === '/api/providers') return handleProviders(req, res)
  if (pathname === '/api/events') return handleEvents(req, res)
  if (pathname === '/api/diagram') return handleDiagram(req, res)
  return serveStatic(req, res)
}
