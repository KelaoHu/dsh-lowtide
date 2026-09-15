/**
 * TaskForm (Phase D + v3.1 + v3.2): the single source of truth for task
 * intake fields.
 *
 * A fully CONTROLLED presentational component — the caller owns the state:
 *  - NewTaskModal (variant="modal") holds local state and submits via the
 *    task API; it also owns `advancedOpen` (the separate advanced window);
 *  - InterceptCard (variant="intercept") binds the prompt to the host input
 *    store (inputActions.setDraft) and keeps the workspace in local state.
 *
 * modal:     prompt (placeholder follows the strategy) + workspace/priority
 *            side by side + strategy (plain pills, hover tooltips, dynamic
 *            explanation line, rounds for iterative/sampling, per-strategy
 *            guidance text) + permission + an "advanced" gear button that
 *            opens a separate SMALL WINDOW (reasoning effort, locked files).
 * intercept: prompt + workspace + empty-workspace warning only — the quick
 *            enqueue surface stays minimal.
 */
import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { Button, IconPaperclipOutline16, IconSettingsOutline14, IconThinkOutline14, IconWarningOutline16, Modal, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { type NsKey, type NsTranslate } from '../i18n.ts'
import styles from './TaskForm.module.css'

export type StrategyId = 'single' | 'iterative' | 'sampling' | 'review'
export type ReasoningId = 'follow' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type AutonomyId = 'l1' | 'l2' | 'l3'
export type SessionModeId = 'new' | 'continue'
export type TaskModelId = string

export interface ReasoningEffortOption {
  id: string
  /** Adapter-native label (e.g. "Low"/"High"); falls back to the raw id. */
  name: string
  description?: string
}

export interface TaskFormModel {
  id: string
  name: string
  /** Canonical provider id — this is what gets submitted as modelProvider. */
  provider: string
  /** Human-friendly provider name for the optgroup label (defaults to the id). */
  providerLabel?: string
  reasoningEfforts?: ReadonlyArray<ReasoningEffortOption>
  defaultReasoningEffort?: string
}

/** A dsh conversation stored under a workspace (from GET /sessions). */
export interface SessionWorkspace {
  cwd: string
  label: string | null
  sessions: Array<{ id: string; title: string | null; lastModified: number }>
}

export interface TaskFormValues {
  prompt: string
  workspace: string
  strategy: StrategyId
  rounds: number
  priority: number
  files: string
  reasoning: ReasoningId
  /** Task-level batch model (advanced window; '' = follow the live selection). */
  model: TaskModelId
  /** Provider for the task-level model (advanced window; '' = follow the live selection). */
  modelProvider: string
  strategyHint: string
  /** Per-task autonomy override; defaults to the global config value. */
  autonomy: AutonomyId
  /** new = standalone session; continue = resume a dsh conversation. */
  sessionMode: SessionModeId
  /** Historical dsh session id when sessionMode === 'continue'. */
  continuesFromSession?: string
}

const PROMPT_PLACEHOLDER_KEYS: Record<StrategyId, NsKey> = {
  single: 'modal.promptPlaceholderSingle',
  iterative: 'modal.promptPlaceholderIterative',
  sampling: 'modal.promptPlaceholderSampling',
  review: 'modal.promptPlaceholderReview',
}

const STRATEGY_LABEL_KEYS: Record<StrategyId, NsKey> = {
  single: 'strategy.single',
  iterative: 'strategy.iterative',
  sampling: 'strategy.sampling',
  review: 'strategy.review',
}

const STRATEGY_HINT_KEYS: Record<StrategyId, NsKey> = {
  single: 'strategy.singleHint',
  iterative: 'strategy.iterativeHint',
  sampling: 'strategy.samplingHint',
  review: 'strategy.reviewHint',
}

const STRATEGY_HINT_LABEL_KEYS: Record<StrategyId, NsKey | null> = {
  single: null,
  iterative: 'modal.strategyHintIterative',
  sampling: 'modal.strategyHintSampling',
  review: 'modal.strategyHintReview',
}

const STRATEGY_HINT_PLACEHOLDER_KEYS: Record<StrategyId, NsKey | null> = {
  single: null,
  iterative: 'strategyHintPlaceholderIterative',
  sampling: 'strategyHintPlaceholderSampling',
  review: 'strategyHintPlaceholderReview',
}

/** Cost factor label for each strategy (displayed on the pill). */
function strategyCostFactor(s: StrategyId, rounds: number): string {
  if (s === 'single') return '1×'
  if (s === 'review') return '2×'
  if (s === 'iterative') return `~${rounds}×`
  return `${rounds}×`
}

/** Pick one random option from a '|||'-delimited i18n string. */
function randomPick(localized: string): string {
  const options = localized.split('|||')
  return options[Math.floor(Math.random() * options.length)]
}

/** Label for a reasoning effort: the adapter's native name, or the raw id. */
function reasoningLabel(effort: ReasoningEffortOption): string {
  return effort.name !== '' ? effort.name : effort.id
}

/** Reasoning efforts to offer for a given model (fallback = standard set). */
function reasoningOptions(model: TaskFormModel | undefined): ReasoningEffortOption[] {
  const efforts = model?.reasoningEfforts
  if (efforts !== undefined && efforts.length > 0) return [...efforts]
  return ['off', 'low', 'high', 'max'].map((id) => ({ id, name: id }))
}

/** 运行模式（自治级别）按钮组：标签 / 悬停一句话 / 选中后说明行。 */
const AUTONOMY_LABEL_KEYS: Record<AutonomyId, NsKey> = {
  l1: 'autonomy.l1',
  l2: 'autonomy.l2',
  l3: 'autonomy.l3',
}

const AUTONOMY_HINT_KEYS: Record<AutonomyId, NsKey> = {
  l1: 'autonomy.l1Hint',
  l2: 'autonomy.l2Hint',
  l3: 'autonomy.l3Hint',
}

const AUTONOMY_DESC_KEYS: Record<AutonomyId, NsKey> = {
  l1: 'autonomy.l1Desc',
  l2: 'autonomy.l2Desc',
  l3: 'autonomy.l3Desc',
}

/** Relative "x min/h ago" label for a session's last activity; falls back
 *  to an absolute "MM-DD HH:mm" label once the session is a day old. */
export function sessionTimeLabel(lastModified: number, t: NsTranslate): string {
  const diff = Date.now() - lastModified
  if (diff < 60_000) return t('modal.time.justNow')
  if (diff < 3_600_000) return t('modal.time.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('modal.time.hoursAgo', { n: Math.floor(diff / 3_600_000) })
  const d = new Date(lastModified)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskForm(props: {
  t: NsTranslate
  variant: 'modal' | 'intercept'
  values: TaskFormValues
  onChange(patch: Partial<TaskFormValues>): void
  autoFocusPrompt?: boolean
  /** Modal variant only: the separate advanced window (v3.2). */
  advancedOpen?: boolean
  onAdvancedOpenChange?(open: boolean): void
  /** Modal variant only: real conversations per workspace for the
   *  "continue from a conversation" mode (from GET /sessions). */
  sessionWorkspaces?: SessionWorkspace[]
  /** Available models from GET /ds-lowtide/models (flattened for the UI). */
  models?: TaskFormModel[]
  /** Registered DSH workspaces from GET /ds-lowtide/workspaces. */
  workspaces?: Array<{ path: string; title: string | null }>
}): ReactElement {
  const { t, variant, values, onChange } = props

  if (variant === 'intercept') {
    return (
      <div className={styles.compact}>
        <textarea
          className={styles.prompt}
          placeholder={t('intercept.inputPlaceholder')}
          value={values.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          rows={3}
        />
        <div className={styles.compactRow}>
          <span className={styles.compactLabel}>{t('intercept.workspaceLabel')}</span>
          <input
            className={styles.compactInput}
            value={values.workspace}
            onChange={(e) => onChange({ workspace: e.target.value })}
            placeholder={t('intercept.workspacePlaceholder')}
          />
        </div>
        {values.workspace.trim() === '' && (
          <div className={styles.warning}>
            <IconWarningOutline16 className={styles.warningIcon} />
            {t('intercept.workspaceWarning')}
          </div>
        )}
      </div>
    )
  }

  const strategy = values.strategy
  const showRounds = strategy === 'iterative' || strategy === 'sampling'
  const hintLabelKey = STRATEGY_HINT_LABEL_KEYS[strategy]
  const hintPlaceholderKey = STRATEGY_HINT_PLACEHOLDER_KEYS[strategy]
  // Random placeholder per strategy — stable until the user switches strategy.
  const promptPlaceholder = useMemo(() => randomPick(t(PROMPT_PLACEHOLDER_KEYS[strategy])), [strategy, t])
  const hintPlaceholder = useMemo(() => {
    const key = hintPlaceholderKey
    return key !== null ? randomPick(t(key)) : ''
  }, [strategy, t])

  return (
    <div className={styles.modal}>
      <textarea
        className={styles.prompt}
        placeholder={promptPlaceholder}
        value={values.prompt}
        onChange={(e) => onChange({ prompt: e.target.value })}
        rows={4}
        autoFocus={props.autoFocusPrompt}
      />
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('modal.workspace')}</span>
        {(() => {
          const ws = props.workspaces ?? []
          if (ws.length > 0) {
            const CUSTOM = '__custom__'
            const isCustom = values.workspace !== '' && !ws.some((w) => w.path === values.workspace)
            const currentValue = isCustom ? CUSTOM : values.workspace
            return (
              <>
                <select
                  className={styles.fieldInput}
                  value={currentValue}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === CUSTOM) return // keep current text, show input below
                    onChange({ workspace: v })
                  }}
                >
                  <option value="">{t('modal.workspaceDefault')}</option>
                  {ws.map((w) => (
                    <option key={w.path} value={w.path}>
                      {w.title !== null ? `${w.title} · ${w.path}` : w.path}
                    </option>
                  ))}
                  <option value={CUSTOM}>{t('modal.workspaceCustom')}</option>
                </select>
                {isCustom && (
                  <input
                    className={styles.fieldInput}
                    value={values.workspace}
                    onChange={(e) => onChange({ workspace: e.target.value })}
                    placeholder={t('modal.workspacePlaceholder')}
                  />
                )}
              </>
            )
          }
          return (
            <input
              className={styles.fieldInput}
              value={values.workspace}
              onChange={(e) => onChange({ workspace: e.target.value })}
              placeholder={t('modal.workspacePlaceholder')}
            />
          )
        })()}
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('modal.strategy')}</span>
        <div className={styles.pillRow}>
          {(['single', 'iterative', 'sampling', 'review'] as const).map((s) => (
            <span
              key={s}
              className={`${styles.strategyPill} ${strategy === s ? styles.strategyActive : ''}`}
              onClick={() => onChange({ strategy: s })}
            >
              {t(STRATEGY_LABEL_KEYS[s])}
              <span className={styles.costTag}>{strategyCostFactor(s, values.rounds)}</span>
            </span>
          ))}
        </div>
        <span className={styles.strategyHint}>{t(STRATEGY_HINT_KEYS[strategy])}</span>
      </div>
      {showRounds && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('modal.rounds')}</span>
          <div className={styles.pillRow}>
            {[2, 3, 4, 5].map((r) => (
              <Pill key={r} active={values.rounds === r} onClick={() => onChange({ rounds: r })}>{r}</Pill>
            ))}
          </div>
        </div>
      )}
      {hintLabelKey !== null && hintPlaceholderKey !== null && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t(hintLabelKey)}</span>
          <textarea
            className={styles.guidanceInput}
            placeholder={hintPlaceholder}
            value={values.strategyHint}
            onChange={(e) => onChange({ strategyHint: e.target.value })}
            rows={2}
          />
        </div>
      )}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('modal.autonomy')}</span>
        <div className={styles.pillRow}>
          {(['l1', 'l2', 'l3'] as const).map((level) => (
            <Tooltip key={level} label={t(AUTONOMY_HINT_KEYS[level])} side="top">
              <span className={styles.autonomyBtn}>
                <Button
                  size="sm"
                  variant={values.autonomy === level ? 'primary' : 'outline'}
                  onClick={() => onChange({ autonomy: level })}
                >
                  {t(AUTONOMY_LABEL_KEYS[level])}
                </Button>
              </span>
            </Tooltip>
          ))}
        </div>
        <span className={styles.strategyHint}>{t(AUTONOMY_DESC_KEYS[values.autonomy])}</span>
      </div>
      {props.onAdvancedOpenChange !== undefined && (
        <>
          <button type="button" className={styles.advancedBtn} onClick={() => props.onAdvancedOpenChange?.(true)}>
            <IconSettingsOutline14 />
            {t('modal.advanced')}
          </button>
          <Modal
            open={props.advancedOpen ?? false}
            onClose={() => props.onAdvancedOpenChange?.(false)}
            title={t('modal.advancedTitle')}
            closeLabel={t('modal.close')}
            footer={
              <Button variant="primary" size="md" onClick={() => props.onAdvancedOpenChange?.(false)}>
                {t('modal.advancedDone')}
              </Button>
            }
          >
            <div className={styles.advancedBody}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t('modal.model')}</span>
                {(() => {
                  const models = props.models ?? []
                  if (models.length > 0) {
                    // Option values carry "provider\0model" so two providers
                    // may serve same-named model ids without colliding.
                    const encode = (m: TaskFormModel): string => `${m.provider}\u0000${m.id}`
                    const decode = (v: string): { model: string; modelProvider: string } => {
                      if (v === '') return { model: '', modelProvider: '' }
                      const at = v.indexOf('\u0000')
                      return at >= 0
                        ? { model: v.slice(at + 1), modelProvider: v.slice(0, at) }
                        : { model: v, modelProvider: '' }
                    }
                    // Current selection: exact provider match first, then
                    // id-only (covers values saved before providers existed).
                    const current = values.model === ''
                      ? ''
                      : (() => {
                          const exact = models.find((m) => m.id === values.model && (values.modelProvider === '' || m.provider === values.modelProvider))
                          const hit = exact ?? models.find((m) => m.id === values.model)
                          return hit !== undefined ? encode(hit) : values.model
                        })()
                    const byProvider = new Map<string, TaskFormModel[]>()
                    for (const m of models) {
                      const list = byProvider.get(m.provider) ?? []
                      list.push(m)
                      byProvider.set(m.provider, list)
                    }
                    return (
                      <select
                        className={styles.fieldInput}
                        value={current}
                        onChange={(e) => {
                          const decoded = decode(e.target.value)
                          // If the new model doesn't support the current
                          // reasoning effort, reset to "follow" so we never
                          // submit an unsupported level (e.g. "max" on a
                          // provider that only offers low/high).
                          const next = models.find((m) => m.id === decoded.model)
                          const efforts = next?.reasoningEfforts
                          const resetReasoning = values.reasoning !== 'follow'
                            && efforts !== undefined
                            && efforts.length > 0
                            && !efforts.some((e) => e.id === values.reasoning)
                          onChange(resetReasoning ? { ...decoded, reasoning: 'follow' } : decoded)
                        }}
                      >
                        <option value="">{t('modal.modelFollowGlobal')}</option>
                        {[...byProvider.keys()].map((provider) => {
                          const group = byProvider.get(provider) ?? []
                          const label = group[0]?.providerLabel ?? provider
                          return (
                            <optgroup key={provider} label={label}>
                              {group.map((m) => (
                                <option key={encode(m)} value={encode(m)}>
                                  {m.name}
                                </option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </select>
                    )
                  }
                  // No enumerable catalog: free-text fallback (model id +
                  // optional provider id — provider defaults to the live one).
                  return (
                    <div className={styles.modelFallbackRow}>
                      <input
                        className={styles.fieldInput}
                        value={values.model}
                        onChange={(e) => onChange({ model: e.target.value })}
                        placeholder="model-id"
                      />
                      <input
                        className={styles.fieldInput}
                        value={values.modelProvider}
                        onChange={(e) => onChange({ modelProvider: e.target.value })}
                        placeholder="provider-id"
                      />
                    </div>
                  )
                })()}
                <span className={styles.strategyHint}>{t('modal.modelHint')}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}><IconThinkOutline14 className={styles.advancedIcon} />{t('modal.reasoning')}</span>
                <div className={styles.pillRow}>
                  <Pill active={values.reasoning === 'follow'} onClick={() => onChange({ reasoning: 'follow' })}>
                    {t('reasoning.follow')}
                  </Pill>
                  {(() => {
                    const selectedModel = props.models?.find((m) => m.id === values.model)
                    return reasoningOptions(selectedModel).map((effort) => (
                      <Pill key={effort.id} active={values.reasoning === effort.id} onClick={() => onChange({ reasoning: effort.id as ReasoningId })}>
                        {reasoningLabel(effort)}
                      </Pill>
                    ))
                  })()}
                </div>
                <span className={styles.strategyHint}>{t('modal.reasoningHint')}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t('modal.priority')}</span>
                <div className={styles.pillRow}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <Pill key={n} active={values.priority === n} onClick={() => onChange({ priority: n })}>{n}</Pill>
                  ))}
                </div>
                <span className={styles.strategyHint}>{t('modal.priorityHint')}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t('modal.sessionMode')}</span>
                <div className={styles.pillRow}>
                  <span
                    className={`${styles.strategyPill} ${values.sessionMode === 'new' ? styles.strategyActive : ''}`}
                    onClick={() => onChange({ sessionMode: 'new', continuesFromSession: undefined })}
                  >
                    {t('modal.sessionNew')}
                  </span>
                  <span
                    className={`${styles.strategyPill} ${values.sessionMode === 'continue' ? styles.strategyActive : ''}`}
                    onClick={() => onChange({ sessionMode: 'continue' })}
                  >
                    {t('modal.sessionContinue')}
                  </span>
                </div>
                <span className={styles.strategyHint}>
                  {values.sessionMode === 'new' ? t('modal.sessionNewHint') : t('modal.sessionContinueHint')}
                </span>
              </div>
              {values.sessionMode === 'continue' && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('modal.selectConversation')}</span>
                  {(() => {
                    const workspaces = props.sessionWorkspaces ?? []
                    if (workspaces.length === 0) {
                      return <span className={styles.strategyHint}>{t('modal.noConversations')}</span>
                    }
                    const currentWs = workspaces.find((w) => w.cwd === values.workspace) ?? workspaces[0]
                    const sessions = currentWs?.sessions ?? []
                    return (
                      <>
                        <div className={styles.sessionPickRow}>
                          <select
                            className={styles.fieldInput}
                            value={currentWs?.cwd ?? ''}
                            onChange={(e) => {
                              const ws = workspaces.find((w) => w.cwd === e.target.value)
                              onChange({ workspace: e.target.value, continuesFromSession: undefined })
                              if (ws !== undefined && ws.sessions.length > 0) {
                                onChange({ continuesFromSession: ws.sessions[0].id })
                              }
                            }}
                          >
                            {workspaces.map((w) => (
                              <option key={w.cwd} value={w.cwd}>
                                {w.label !== null ? `${w.label} · ${w.cwd}` : w.cwd}
                              </option>
                            ))}
                          </select>
                          <select
                            className={styles.fieldInput}
                            value={values.continuesFromSession ?? ''}
                            onChange={(e) => onChange({ continuesFromSession: e.target.value || undefined })}
                          >
                            <option value="">{t('modal.selectConversationPlaceholder')}</option>
                            {sessions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title !== null && s.title !== '' ? s.title : s.id.slice(0, 16)}
                                {s.lastModified > 0 ? ` · ${sessionTimeLabel(s.lastModified, t)}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        <span className={styles.strategyHint}>{t('modal.continueHint', { cwd: currentWs?.cwd ?? '' })}</span>
                      </>
                    )
                  })()}
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.fieldLabel}><IconPaperclipOutline16 className={styles.advancedIcon} />{t('modal.files')}</span>
                <input className={styles.fieldInput} value={values.files} onChange={(e) => onChange({ files: e.target.value })} placeholder={t('modal.filesPlaceholder')} />
                <span className={styles.strategyHint}>{t('modal.filesAdvancedHint')}</span>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  )
}
