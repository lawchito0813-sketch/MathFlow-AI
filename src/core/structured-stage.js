import { createEvent, SESSION_EVENT_TYPES } from '../utils/events.js'
import { parseJsonFromText } from '../utils/json.js'

function sanitizeBrokenJsonSnippet(text) {
  return String(text || '')
    .slice(0, 6000)
    .replaceAll('```json', '```')
    .replaceAll('```JSON', '```')
}

function getErrorMessage(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

function createModelCallEmitter({ emit, modelCall }) {
  if (!emit || !modelCall) return null

  const basePayload = {
    scope: modelCall.scope || 'generic',
    callRole: modelCall.callRole || 'model',
    stageKey: modelCall.stageKey || '',
    providerId: modelCall.providerId || '',
    questionId: modelCall.questionId || '',
    questionNumber: modelCall.questionNumber || '',
    questionNumbers: Array.isArray(modelCall.questionNumbers) ? modelCall.questionNumbers : [],
    groupId: modelCall.groupId || '',
    attemptLabel: modelCall.attemptLabel || 'initial'
  }

  return {
    started(extra = {}) {
      emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_STARTED, {
        ...basePayload,
        mode: modelCall.stream === false ? 'stable' : 'stream',
        ...extra
      }))
    },
    delta(delta, extra = {}) {
      emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_DELTA, {
        ...basePayload,
        delta,
        ...extra
      }))
    },
    done(text, extra = {}) {
      emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_DONE, {
        ...basePayload,
        text,
        ...extra
      }))
    },
    failed(message, extra = {}) {
      emit(createEvent(SESSION_EVENT_TYPES.MODEL_CALL_FAILED, {
        ...basePayload,
        message,
        ...extra
      }))
    }
  }
}

async function requestStructuredText({ request, prompt, emitDelta, modelCallEmitter, modelCallExtra = {} }) {
  let text = ''
  const startedAt = Date.now()
  modelCallEmitter?.started(modelCallExtra)

  try {
    const response = await request(prompt, delta => {
      text += delta
      emitDelta?.(delta)
      modelCallEmitter?.delta(delta, { ...modelCallExtra, text })
    })

    const finalText = text || response?.text || ''
    if (!text && finalText) {
      modelCallEmitter?.delta(finalText, { ...modelCallExtra, text: finalText, finalChunk: true })
    }
    modelCallEmitter?.done(finalText, {
      ...modelCallExtra,
      durationMs: Date.now() - startedAt
    })
    return finalText
  } catch (error) {
    modelCallEmitter?.failed(getErrorMessage(error, '模型呼叫失敗'), {
      ...modelCallExtra,
      durationMs: Date.now() - startedAt
    })
    throw error
  }
}

export async function runStructuredStage({
  stageKey,
  emit,
  request,
  mainPrompt,
  compactPrompt,
  buildRepairPrompt,
  validator,
  startedEvent,
  deltaEvent,
  repairingEvent,
  compactRetryEvent,
  failedEvent,
  fallback,
  modelCall
}) {
  if (startedEvent) {
    emit(createEvent(startedEvent, { stage: stageKey, mode: mainPrompt?.stream === false ? 'stable' : 'stream' }))
  }

  const emitDelta = deltaEvent
    ? delta => emit(createEvent(deltaEvent, { delta }))
    : null

  let latestText = ''

  try {
    latestText = await requestStructuredText({
      request,
      prompt: mainPrompt,
      emitDelta,
      modelCallEmitter: createModelCallEmitter({
        emit,
        modelCall: {
          ...modelCall,
          stageKey,
          providerId: modelCall?.providerId || mainPrompt?.providerId || '',
          stream: mainPrompt?.stream,
          schedulerOptions: modelCall?.schedulerOptions || null
        }
      }),
      modelCallExtra: { attemptLabel: 'initial' }
    })
    return validator(parseJsonFromText(latestText))
  } catch (firstError) {
    const firstMessage = getErrorMessage(firstError, `${stageKey} 解析失敗`)
    emit(createEvent(repairingEvent || SESSION_EVENT_TYPES.STAGE_REPAIRING, {
      stage: stageKey,
      message: firstMessage
    }))

    try {
      const repairPrompt = buildRepairPrompt({
        basePrompt: mainPrompt,
        brokenOutput: sanitizeBrokenJsonSnippet(latestText),
        errorMessage: firstMessage
      })
      latestText = await requestStructuredText({
        request,
        prompt: repairPrompt,
        emitDelta,
        modelCallEmitter: createModelCallEmitter({
          emit,
          modelCall: {
            ...modelCall,
            stageKey,
            providerId: modelCall?.providerId || repairPrompt?.providerId || mainPrompt?.providerId || '',
            stream: repairPrompt?.stream,
            schedulerOptions: modelCall?.schedulerOptions || null
          }
        }),
        modelCallExtra: { attemptLabel: 'repair' }
      })
      return validator(parseJsonFromText(latestText))
    } catch (secondError) {
      const secondMessage = getErrorMessage(secondError, `${stageKey} 二次解析失敗`)

      if (compactPrompt) {
        emit(createEvent(compactRetryEvent || SESSION_EVENT_TYPES.STAGE_COMPACT_RETRY, {
          stage: stageKey,
          message: secondMessage
        }))

        try {
          const compactRepairPrompt = buildRepairPrompt({
            basePrompt: compactPrompt,
            brokenOutput: sanitizeBrokenJsonSnippet(latestText),
            errorMessage: secondMessage,
            compact: true
          })
          latestText = await requestStructuredText({
            request,
            prompt: compactRepairPrompt,
            emitDelta,
            modelCallEmitter: createModelCallEmitter({
              emit,
              modelCall: {
                ...modelCall,
                stageKey,
                providerId: modelCall?.providerId || compactRepairPrompt?.providerId || compactPrompt?.providerId || '',
                stream: compactRepairPrompt?.stream,
                schedulerOptions: modelCall?.schedulerOptions || null
              }
            }),
            modelCallExtra: { attemptLabel: 'compact_retry' }
          })
          return validator(parseJsonFromText(latestText))
        } catch (thirdError) {
          const thirdMessage = getErrorMessage(thirdError, `${stageKey} 精簡重試失敗`)
          if (fallback) {
            emit(createEvent(failedEvent || SESSION_EVENT_TYPES.STAGE_FAILED, {
              stage: stageKey,
              message: thirdMessage,
              fallback: true
            }))
            return fallback(thirdMessage)
          }
          emit(createEvent(failedEvent || SESSION_EVENT_TYPES.STAGE_FAILED, {
            stage: stageKey,
            message: thirdMessage,
            fallback: false
          }))
          throw new Error(thirdMessage)
        }
      }

      if (fallback) {
        emit(createEvent(failedEvent || SESSION_EVENT_TYPES.STAGE_FAILED, {
          stage: stageKey,
          message: secondMessage,
          fallback: true
        }))
        return fallback(secondMessage)
      }

      emit(createEvent(failedEvent || SESSION_EVENT_TYPES.STAGE_FAILED, {
        stage: stageKey,
        message: secondMessage,
        fallback: false
      }))
      throw new Error(secondMessage)
    }
  }
}
