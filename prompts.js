function jsonBlockInstructions(schemaDescription) {
  return [
    '你必须只输出合法 JSON。',
    '不要输出 markdown 代码块。',
    '不要输出额外解释。',
    schemaDescription
  ].join('\n')
}

export function buildNormalizeImagePrompt() {
  return {
    system: [
      '你是数学题图片理解助手。',
      '你的职责是从图片题目中提取题干、已知条件、目标。',
      '若条件不足，不要编造。',
      jsonBlockInstructions('返回 JSON: {"sourceType":"image","problemText":"","extractedText":"","knownConditions":[],"goal":"","requiresDiagram":true}')
    ].join('\n'),
    user(input) {
      return [
        '请根据这张数学题图片提取题意。',
        '如果图片有模糊处，请尽量保守表达。',
        `图片(base64): ${input.imageBase64}`
      ].join('\n\n')
    }
  }
}

export function buildSolverPrompt({ variant, sourceType, normalizedProblem }) {
  const variantInstruction = variant === 'A'
    ? '你偏向直接推导，快速给出清晰步骤。'
    : '你偏向仔细校验条件、分步验算并检查常见错误。'

  return {
    system: [
      '你是数学解题助手。',
      variantInstruction,
      '必须逐步解题，不可跳过关键推导。',
      '若条件不足，必须明确指出。',
      jsonBlockInstructions('返回 JSON: {"steps":[],"finalAnswer":"","confidence":"high|medium|low","assumptions":[],"summary":""}')
    ].join('\n'),
    user() {
      return [
        `输入类型: ${sourceType}`,
        `题目: ${normalizedProblem.problemText}`,
        normalizedProblem.knownConditions.length > 0 ? `已知条件: ${normalizedProblem.knownConditions.join('；')}` : '已知条件: 无法额外提取',
        normalizedProblem.goal ? `求解目标: ${normalizedProblem.goal}` : '求解目标: 请从题意中判断'
      ].join('\n')
    }
  }
}

export function buildJudgePrompt({ normalizedProblem, solverA, solverB }) {
  return {
    system: [
      '你是数学裁决助手。',
      '你的职责是比较两份解答，找出冲突，给出更可信的最终答案。',
      '不能盲目折中，必须指出采信理由。',
      jsonBlockInstructions('返回 JSON: {"finalAnswer":"","chosenSolver":"A|B","reasoning":"","conflictPoints":[],"confidence":"high|medium|low"}')
    ].join('\n'),
    user() {
      return [
        `题目: ${normalizedProblem.problemText}`,
        `Solver A: ${JSON.stringify(solverA)}`,
        `Solver B: ${JSON.stringify(solverB)}`
      ].join('\n\n')
    }
  }
}

export function buildDiagramPlanPrompt({ normalizedProblem, judgeResult }) {
  return {
    system: [
      '你是数学作图规划助手。',
      '根据题目上下文和最终答案，输出一个结构化绘图规格。',
      '不要输出图片本身，只输出可被后端渲染的 JSON。',
      jsonBlockInstructions('返回 JSON: {"title":"","description":"","shapes":[],"labels":[]}')
    ].join('\n'),
    user() {
      return [
        `题目: ${normalizedProblem.problemText}`,
        `最终答案: ${judgeResult.finalAnswer}`,
        '请输出适合后端渲染为题目示意图的结构化规格。'
      ].join('\n\n')
    }
  }
}
