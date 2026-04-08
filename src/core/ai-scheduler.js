function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function createAiScheduler({ minIntervalMs = 500, maxConcurrent = 2 } = {}) {
  let running = 0
  let lastStart = 0
  const queue = []

  async function pump() {
    if (running >= maxConcurrent || queue.length === 0) return

    const now = Date.now()
    const delay = Math.max(0, minIntervalMs - (now - lastStart))
    if (delay > 0) {
      await wait(delay)
    }

    if (running >= maxConcurrent || queue.length === 0) return

    const task = queue.shift()
    running += 1
    lastStart = Date.now()

    try {
      const result = await task.run()
      task.resolve(result)
    } catch (error) {
      task.reject(error)
    } finally {
      running -= 1
      pump().catch(() => {})
    }
  }

  function schedule(run) {
    return new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject })
      pump().catch(reject)
    })
  }

  return {
    schedule,
    stats() {
      return { running, queued: queue.length, lastStart }
    }
  }
}
