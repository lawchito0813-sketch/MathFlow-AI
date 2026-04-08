import http from 'node:http'
import { createAiScheduler } from '../core/ai-scheduler.js'
import { routeRequest } from './routes.js'

process.on('uncaughtException', error => {
  console.error('[uncaughtException]', error)
})

process.on('unhandledRejection', error => {
  console.error('[unhandledRejection]', error)
})

if (!globalThis.__MATH_SESSIONS__) {
  globalThis.__MATH_SESSIONS__ = new Map()
}

if (!globalThis.__MATH_SESSION_EMITTERS__) {
  globalThis.__MATH_SESSION_EMITTERS__ = new Map()
}

if (!globalThis.__AI_SCHEDULER__) {
  globalThis.__AI_SCHEDULER__ = createAiScheduler({ minIntervalMs: 0, maxConcurrent: 24 })
}

const port = Number(process.env.PORT || 3000)

const server = http.createServer((req, res) => {
  routeRequest(req, res).catch(error => {
    res.writeHead(500, {
      'content-type': 'application/json; charset=utf-8'
    })
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : '伺服器內部錯誤'
    }))
  })
})

server.listen(port, () => {
  console.log(`AI 數學後端已啟動：http://localhost:${port}`)
})
