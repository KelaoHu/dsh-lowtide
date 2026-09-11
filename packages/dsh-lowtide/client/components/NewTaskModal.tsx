/**
 * NewTaskModal (Phase D split): the intake modal — drives the shared
 * TaskForm (modal variant) and submits through the task API. The "continue"
 * mode lets the user resume a dsh conversation from any workspace
 * (GET /ds-lowtide/sessions).
 */
import { useEffect, useState } from 'react'
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { getModels, getSessions, getWorkspaces, rememberWorkspace, submitTask, type WorkspaceSessionsEntry } from '../api.ts'
import { showToast } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { TaskForm, type AutonomyId, type SessionWorkspace, type TaskFormModel, type TaskFormValues } from './TaskForm.tsx'
import styles from './NewTaskModal.module.css'

export function NewTaskModal({ open, t, defaultAutonomy, onClose }: {
  open: boolean
  t: NsTranslate
  /** Global autonomy from the live state — the button group starts here. */
  defaultAutonomy: AutonomyId
  onClose: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<TaskFormValues>({
    prompt: '',
    workspace: (() => { try { return localStorage.getItem('dsh-lowtide:last-workspace') ?? '' } catch { return '' } })(),
    strategy: 'single',
    rounds: 3,
    priority: 3,
    files: '',
    reasoning: 'follow',
    // v0.2.2: no hard-coded model — follow the live Harness selection (a
    // pinned legacy id would survive DeepSeek renames and mis-price tasks).
    model: '',
    modelProvider: '',
    strategyHint: '',
    autonomy: defaultAutonomy,
    sessionMode: 'new',
    continuesFromSession: undefined,
  })
  const [busy, setBusy] = useState(false)
  // v3.2: the advanced fields live in a separate SMALL WINDOW; the state
  // lives here so one Escape closes only the top window (see mainOnClose).
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Real conversations per workspace — REFRESHED on every modal open so a
  // conversation created since the last open is immediately selectable.
  const [sessionWorkspaces, setSessionWorkspaces] = useState<SessionWorkspace[] | null>(null)
  // All available models from the host (deepseek + any llm-pi-ai).
  const [models, setModels] = useState<TaskFormModel[] | null>(null)
  // All registered DSH workspaces (for the workspace picker).
  const [workspaces, setWorkspaces] = useState<Array<{ path: string; title: string | null }> | null>(null)

  useEffect(() => {
    if (open) {
      void getSessions().then((res) => {
        if (res.ok && res.workspaces !== undefined) {
          setSessionWorkspaces(res.workspaces.map((w: WorkspaceSessionsEntry) => w))
        } else {
          setSessionWorkspaces([])
        }
      }).catch(() => setSessionWorkspaces([]))
    }
  }, [open])

  useEffect(() => {
    if (open && models === null) {
      void getModels().then((res) => {
        if (res.ok && res.providers !== undefined) {
          const flat: TaskFormModel[] = []
          for (const p of res.providers) {
            for (const m of p.models) {
              flat.push({
                id: m.id,
                name: m.name,
                // The option value encodes "provider\0model" and the server
                // validates modelProvider against ctx.llm.listProviders() ids,
                // so the SUBMITTED provider must be the canonical id — never
                // the display name (which may differ, e.g. deepseek-official →
                // "DeepSeek"). The display name is kept separately for the
                // optgroup label only.
                provider: p.provider,
                ...(p.displayName !== undefined && p.displayName !== '' && p.displayName !== p.provider
                  ? { providerLabel: p.displayName }
                  : {}),
                ...(m.reasoningEfforts !== undefined ? { reasoningEfforts: m.reasoningEfforts } : {}),
                ...(m.defaultReasoningEffort !== undefined ? { defaultReasoningEffort: m.defaultReasoningEffort } : {}),
              })
            }
          }
          setModels(flat)
        } else {
          setModels([])
        }
      }).catch(() => setModels([]))
    }
  }, [open, models])

  useEffect(() => {
    if (open && workspaces === null) {
      void getWorkspaces().then((res) => {
        if (res.ok && res.workspaces !== undefined) {
          setWorkspaces(res.workspaces)
        } else {
          setWorkspaces([])
        }
      }).catch(() => setWorkspaces([]))
    }
  }, [open, workspaces])

  /** Esc/mask on the MAIN modal: while the advanced window is up, close only
   *  that window; a second Esc closes the main modal. */
  function mainOnClose(): void {
    if (advancedOpen) setAdvancedOpen(false)
    else onClose()
  }

  function patch(p: Partial<TaskFormValues>): void {
    setForm((f) => ({ ...f, ...p }))
  }

  async function submit(): Promise<void> {
    if (form.prompt.trim() === '') return
    setBusy(true)
    const result = await submitTask({
      prompt: form.prompt,
      files: form.files.split(',').map((p) => p.trim()).filter((p) => p !== ''),
      workspace: form.workspace,
      priority: form.priority,
      // 权限档选择已从 UI 移除（用户反馈冗余）：任务统一按标准档执行。
      permissionPreset: 'lt-standard',
      strategy: form.strategy,
      rounds: form.strategy === 'single' || form.strategy === 'review' ? 1 : form.rounds,
      ...(form.reasoning !== 'follow' ? { reasoning: form.reasoning } : {}),
      // Model override: '' = follow the live selection — send nothing.
      ...(form.model !== ''
        ? { model: form.model, ...(form.modelProvider !== '' ? { modelProvider: form.modelProvider } : {}) }
        : {}),
      ...(form.strategyHint.trim() !== '' ? { strategyHint: form.strategyHint.trim() } : {}),
      autonomy: form.autonomy,
      ...(form.sessionMode === 'continue' && form.continuesFromSession !== undefined ? { continuesFromSession: form.continuesFromSession } : {}),
    })
    setBusy(false)
    if (result.ok) {
      if (form.workspace !== '') rememberWorkspace(form.workspace)
      showToast(t('toast.submitted'))
      setForm((f) => ({ ...f, prompt: '', files: '', strategyHint: '', sessionMode: 'new', continuesFromSession: undefined }))
      setAdvancedOpen(false)
      onClose()
    } else {
      showToast(t('toast.submitFailed', { error: result.error ?? 'unknown' }))
    }
  }

  return (
    <Modal
      open={open}
      onClose={mainOnClose}
      title={t('modal.title')}
      description={t('modal.desc')}
      className={styles.wide}
      footer={
        <div className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>{t('modal.cancel')}</Button>
          <Button variant="primary" size="md" disabled={busy || form.prompt.trim() === ''} onClick={() => void submit()}>{t('modal.submit')}</Button>
        </div>
      }
    >
      <div className={styles.modalBody}>
        <TaskForm variant="modal" t={t} values={form} onChange={patch} autoFocusPrompt advancedOpen={advancedOpen} onAdvancedOpenChange={setAdvancedOpen} sessionWorkspaces={sessionWorkspaces ?? []} models={models ?? undefined} workspaces={workspaces ?? undefined} />
      </div>
    </Modal>
  )
}
