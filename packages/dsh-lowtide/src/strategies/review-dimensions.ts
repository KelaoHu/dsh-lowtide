/**
 * Review dimensions for the smart-iterative strategy (Kimi refactor plan §3,
 * corrected): per-task-type structured review dimensions instead of the
 * vague "请改进". Pure data + a keyword-based task-type inferrer.
 */

export type TaskType = 'code-review' | 'doc-generation' | 'test-generation' | 'refactoring' | 'general'

export interface ReviewDimension {
  id: string
  name: string
  prompt: string
}

export const DIMENSIONS: Record<TaskType, ReviewDimension[]> = {
  'code-review': [
    { id: 'correctness', name: '正确性', prompt: '检查是否有逻辑错误、边界条件遗漏、空指针风险、类型不匹配' },
    { id: 'security', name: '安全性', prompt: '检查是否有注入风险、越权访问、敏感信息泄露' },
    { id: 'performance', name: '性能', prompt: '检查是否有明显性能问题：O(n²) 循环、重复计算、不必要的 IO' },
    { id: 'completeness', name: '完整性', prompt: '检查是否处理了所有需求点、是否有遗漏的分支' },
  ],
  'doc-generation': [
    { id: 'accuracy', name: '准确性', prompt: '检查描述是否与代码行为一致，参数/返回值说明是否正确' },
    { id: 'completeness', name: '完整性', prompt: '检查是否覆盖所有 public API、是否有使用示例与异常说明' },
    { id: 'clarity', name: '清晰度', prompt: '检查表达是否简洁、有无歧义、结构是否合理' },
  ],
  'test-generation': [
    { id: 'coverage', name: '覆盖率', prompt: '检查是否覆盖正常路径、边界条件、异常路径' },
    { id: 'correctness', name: '正确性', prompt: '检查断言是否正确、mock 是否合理、异步处理是否正确' },
  ],
  refactoring: [
    { id: 'equivalence', name: '等价性', prompt: '检查重构后行为是否与之前一致、是否有功能遗漏' },
    { id: 'improvement', name: '改进度', prompt: '检查是否真正解决了原有问题、是否引入新的复杂度' },
  ],
  general: [
    { id: 'correctness', name: '正确性', prompt: '检查结果是否有事实错误、逻辑漏洞、自相矛盾' },
    { id: 'completeness', name: '完整性', prompt: '检查是否回答了用户全部问题、是否有遗漏' },
    { id: 'clarity', name: '清晰度', prompt: '检查表达是否清楚、结构是否合理、是否容易理解' },
  ],
}

/** Keyword heuristic for the task type (zh + en). */
export function inferTaskType(prompt: string): TaskType {
  const p = prompt.toLowerCase()
  if (/(测试|test|spec)/.test(p)) return 'test-generation'
  if (/(文档|doc|readme|说明)/.test(p)) return 'doc-generation'
  if (/(重构|refactor|重写|rewrite)/.test(p)) return 'refactoring'
  if (/(审查|review|代码|code|bug|修复|fix)/.test(p)) return 'code-review'
  return 'general'
}
