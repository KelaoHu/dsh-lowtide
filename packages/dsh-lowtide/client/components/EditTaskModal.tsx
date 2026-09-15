/**
 * EditTaskModal: in-place task editing for the off-peak queue.
 *
 * Reuses the SAME TaskForm and the SAME modal shell/styles as NewTaskModal —
 * editing feels exactly like creating, except the form is pre-filled with the
 * task's current values and the primary button says "保存修改" instead of
 * "投递". Identity (task id, createdAt) and status are preserved by the
 * server; this modal only submits the (full, refilled) form.
 */
import { useEffect, useState } from 'react'
import { Modal, Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { editTask, getModels, getSessions, getWorkspaces, type WorkspaceSessionsEntry } from '../api.ts'
import { showToast, type HostTask } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { TaskForm, type AutonomyId, type SessionWorkspace, type TaskFormModel, type TaskFormValues } from './TaskForm.tsx'
import styles from './NewTaskModal.module.css'

function valueOf(task: HostTask, defaultAutonomy: AutonomyId): TaskFormValues {
  return {
    prompt: task.prompt,
    workspace: task.workspace,
    strategy: task.strategy ?? 'single',
    rounds: task.rounds ?? 3,
    priority: task.priority,
    files: task.files.map((f) => f.path).join(', '),
    reasoning: task.reasoning ?? 'follow',
    model: task.model ?? '',
    modelProvider: task.modelProvider ?? '',
    strategyHint: task.strategyHint ?? '',
    autonomy: (task.autonomy ?? defaultAutonomy) as AutonomyId,
    sessionMode: task.continuesFromSession !== undefined ? 'continue' : 'new',
    continuesFromSession: task.continuesFromSession,
  }
}

export function EditTaskModal({ task, t, defaultAutonomy, onClose }: {
  task: HostTask
  t: NsTranslate
  /** Global autonomy from the live state — only used when the task carries no override. */
  defaultAutonomy: AutonomyId
  onClose: () => void
}): React.JSX.Element {
  const [form, setForm] = useState<TaskFormValues>(() => valueOf(task, defaultAutonomy))
  const [busy, setBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [sessionWorkspaces, setSessionWorkspaces] = useState<SessionWorkspace[] | null>(null)
  const [models, setModels] = useState<TaskFormModel[] | null>(null)
  const [workspaces, setWorkspaces] = useState<Array<{ path: string; title: string | null }> | null>(null)

  // The advanced window's model picker (same lazy load as NewTaskModal).
  useEffect(() => {
    if (advancedOpen && models === null) {
      void getModels().then((res) => {
        if (res.ok && res.providers !== undefined) {
          const flat: TaskFormModel[] = []
          for (const p of res.providers) {
            for (const m of p.models) {
              flat.push({
                id: m.id,
                name: m.name,
                // Submitted modelProvider must be the canonical provider id
                // (server validates against listProviders()), never the
                // display name — see NewTaskModal for the same mapping.
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
  }, [advancedOpen, models])

  useEffect(() => {
    if (advancedOpen && sessionWorkspaces === null) {
      void getSessions().then((res) => {
        if (res.ok && res.workspaces !== undefined) {
          setSessionWorkspaces(res.workspaces.map((w: WorkspaceSessionsEntry) => w))
        } else {
          setSessionWorkspaces([])
        }
      }).catch(() => setSessionWorkspaces([]))
    }
  }, [advancedOpen, sessionWorkspaces])

  useEffect(() => {
    if (advancedOpen && workspaces === null) {
      void getWorkspaces().then((res) => {
        if (res.ok && res.workspaces !== undefined) {
          setWorkspaces(res.workspaces)
        } else {
          setWorkspaces([])
        }
      }).catch(() => setWorkspaces([]))
    }
  }, [advancedOpen, workspaces])

  function patch(p: Partial<TaskFormValues>): void {
    setForm((f) => ({ ...f, ...p }))
  }

  async function save(): Promise<void> {
    if (form.prompt.trim() === '') return
    setBusy(true)
    const result = await editTask(task.id, {
      prompt: form.prompt,
      files: form.files.split(',').map((p) => p.trim()).filter((p) => p !== ''),
      workspace: form.workspace,
      priority: form.priority,
      permissionPreset: task.permissionPreset,
      strategy: form.strategy,
      rounds: form.strategy === 'single' || form.strategy === 'review' ? 1 : form.rounds,
      ...(form.reasoning !== 'follow' ? { reasoning: form.reasoning } : {}),
      ...(form.model !== ''
        ? { model: form.model, ...(form.modelProvider !== '' ? { modelProvider: form.modelProvider } : {}) }
        : {}),
      ...(form.strategyHint.trim() !== '' ? { strategyHint: form.strategyHint.trim() } : {}),
      autonomy: form.autonomy,
      ...(form.sessionMode === 'continue' && form.continuesFromSession !== undefined ? { continuesFromSession: form.continuesFromSession } : {}),
    })
    setBusy(false)
    if (result.ok) {
      showToast(t('toast.edited'))
      onClose()
    } else {
      showToast(t('toast.editFailed', { error: result.error ?? 'unknown' }))
    }
  }

  function mainOnClose(): void {
    if (advancedOpen) setAdvancedOpen(false)
    else onClose()
  }

  return (
    <Modal
      open
      onClose={mainOnClose}
      title={t('modal.editTitle')}
      closeLabel={t('modal.close')}
      description={t('modal.editDesc', { id: task.id })}
      className={styles.wide}
      footer={
        <div className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>{t('modal.cancel')}</Button>
          <Button variant="primary" size="md" disabled={busy || form.prompt.trim() === ''} onClick={() => void save()}>{t('modal.saveEdit')}</Button>
        </div>
      }
    >
      <div className={styles.modalBody}>
        <TaskForm variant="modal" t={t} values={form} onChange={patch} autoFocusPrompt advancedOpen={advancedOpen} onAdvancedOpenChange={setAdvancedOpen} sessionWorkspaces={sessionWorkspaces ?? []} models={models ?? undefined} workspaces={workspaces ?? undefined} />
      </div>
    </Modal>
  )
}
