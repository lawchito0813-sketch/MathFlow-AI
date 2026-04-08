export const SESSION_EVENT_TYPES = {
  SESSION_STARTED: 'session_started',
  INPUT_RECEIVED: 'input_received',
  PROBLEM_NORMALIZED: 'problem_normalized',
  SOLVER_A_STARTED: 'solver_a_started',
  SOLVER_B_STARTED: 'solver_b_started',
  SOLVER_A_DELTA: 'solver_a_delta',
  SOLVER_B_DELTA: 'solver_b_delta',
  SOLVER_A_DONE: 'solver_a_done',
  SOLVER_B_DONE: 'solver_b_done',
  JUDGE_STARTED: 'judge_started',
  JUDGE_DELTA: 'judge_delta',
  JUDGE_DONE: 'judge_done',
  FINAL_ANSWER_READY: 'final_answer_ready',
  DIAGRAM_STARTED: 'diagram_started',
  DIAGRAM_DONE: 'diagram_done',
  DIAGRAM_ERROR: 'diagram_error',
  SESSION_ERROR: 'session_error'
}

export function createEvent(type, payload = {}) {
  return {
    type,
    timestamp: new Date().toISOString(),
    payload
  }
}
