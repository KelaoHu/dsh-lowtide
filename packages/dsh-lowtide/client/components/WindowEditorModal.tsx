/**
 * WindowEditorModal (v4): the pill's quick window editor — click the header
 * status pill to define 闲时/忙时 time windows in YOUR LOCAL time, multiple
 * segments per day, with a live 24h band preview.
 *
 * Scope split with the settings page:
 *  - HERE: base segments (level ∈ peak|off, no tz/multiplier) — the
 *    everyday "which hours are busy" control. Weekday-restricted segments
 *    (e.g. the official windows, days 1–5) ARE shown here and their `days`
 *    survive editing/saving, so "weekends always off-peak" stays intact.
 *  - SETTINGS: advanced windows (custom ×multiplier, explicit tz) —
 *    untouched by this editor and preserved on save.
 */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { getConfig, getStateMeta, updateConfig } from '../api.ts'
import { refreshNow, showToast } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { PriceBand } from './PriceBand.tsx'
import styles from './WindowEditorModal.module.css'

interface SegmentDraft {
  level: 'peak' | 'off'
  start: string
  end: string
  /** Weekday restriction (1=Mon..7=Sun); undefined = every day. The official
   *  windows carry [1,2,3,4,5] so weekends stay off-peak. */
  days?: number[]
}

/** Short human label for a segment's weekday restriction. */
function daysLabel(days: number[] | undefined, t: NsTranslate): string | null {
  if (days === undefined || days.length === 0) return null
  const sorted = [...days].sort((a, b) => a - b)
  const isWeekday = sorted.length === 5 && sorted.every((d) => d >= 1 && d <= 5)
  const isWeekend = sorted.length === 2 && sorted.includes(6) && sorted.includes(7)
  if (isWeekday) return t('editor.daysWeekday')
  if (isWeekend) return t('editor.daysWeekend')
  return t('editor.daysCustom', { days: sorted.join(',') })
}

function utcOffsetLabel(): string {
  const minutes = -new Date().getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  return `UTC${sign}${abs % 60 === 0 ? String(abs / 60) : `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`}`
}

export function WindowEditorModal({ open, onClose, t }: {
  open: boolean
  onClose: () => void
  t: NsTranslate
}): React.JSX.Element {
  const [segments, setSegments] = useState<SegmentDraft[]>([])
  const [officialLocal, setOfficialLocal] = useState<Array<{ start: string; end: string }>>([])
  const [systemTz, setSystemTz] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setError(null)
    // /state carries the local-time meta (official-in-local + system tz).
    void getStateMeta().then((meta) => {
      if (!alive) return
      if (meta.ok) {
        setOfficialLocal(meta.officialInLocal ?? [])
        setSystemTz(meta.systemTz ?? '')
      }
    }).catch(() => { /* meta is non-critical */ })
    // /config carries the persisted windows.
    void getConfig().then((res) => {
      if (!alive) return
      if (!res.ok || res.config === undefined) {
        setError(t('settings.configError', { error: res.error ?? 'unknown' }))
        return
      }
      const c = res.config as Record<string, any>
      const windows = Array.isArray(c.windows) ? c.windows : []
      // Base = peak/off windows without tz/multiplier. Weekday-restricted
      // windows (official: days 1–5) are base too — they must stay visible
      // and editable here, with their `days` preserved on save.
      const isBase = (w: Record<string, any>): boolean =>
        (w.level === 'peak' || w.level === 'off')
        && (w.tz === undefined || w.tz === '')
        && w.multiplier === undefined
      const base: SegmentDraft[] = windows.filter(isBase).map((w) => ({
        level: w.level === 'peak' ? 'peak' : 'off',
        start: typeof w.start === 'string' ? w.start : '00:00',
        end: typeof w.end === 'string' ? w.end : '23:59',
        ...(Array.isArray(w.days) && w.days.length > 0
          ? { days: w.days.filter((n: unknown): n is number => typeof n === 'number') }
          : {}),
      }))
      const hasAdvanced = windows.some((w) => !isBase(w))
      setSegments(base.length > 0 || hasAdvanced ? base : [])
    }).catch((reason) => {
      if (alive) setError(t('settings.configError', { error: reason instanceof Error ? reason.message : String(reason) }))
    })
    return () => { alive = false }
  }, [open, t])

  function patch(index: number, p: Partial<SegmentDraft>): void {
    setSegments((list) => list.map((s, i) => (i === index ? { ...s, ...p } : s)))
  }

  function remove(index: number): void {
    setSegments((list) => list.filter((_, i) => i !== index))
  }

  /** 恢复官方时段(换算到本地):带工作日限制(days 1–5),周末保持全天闲时。 */
  function restoreOfficial(): void {
    if (officialLocal.length > 0) {
      setSegments(officialLocal.map((w) => ({
        level: 'peak' as const,
        start: w.start,
        end: w.end,
        days: [1, 2, 3, 4, 5],
      })))
    }
  }

  /** 全天闲时:显式一段 00:00–23:59 off。 */
  function allOff(): void {
    setSegments([{ level: 'off', start: '00:00', end: '23:59' }])
  }

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const cfg = await getConfig()
      if (!cfg.ok || cfg.config === undefined) {
        setError(t('settings.configError', { error: cfg.error ?? 'unknown' }))
        setSaving(false)
        return
      }
      const c = cfg.config as Record<string, any>
      const windows = Array.isArray(c.windows) ? c.windows : []
      const isBase = (w: Record<string, any>): boolean =>
        (w.level === 'peak' || w.level === 'off')
        && (w.tz === undefined || w.tz === '')
        && w.multiplier === undefined
      const advanced = windows.filter((w) => !isBase(w))
      const editedBase = segments.map((s, i) => ({
        id: `win-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        level: s.level,
        start: s.start,
        end: s.end,
        ...(s.days !== undefined && s.days.length > 0 ? { days: s.days } : {}),
      }))
      const res = await updateConfig({ windows: [...editedBase, ...advanced] })
      setSaving(false)
      if (res.ok) {
        showToast(t('toast.windowsSaved'))
        refreshNow()
        onClose()
      } else {
        setError(t('toast.saveFailed', { error: res.error ?? 'unknown' }))
      }
    } catch (reason) {
      setSaving(false)
      setError(t('toast.saveFailed', { error: reason instanceof Error ? reason.message : String(reason) }))
    }
  }

  const nowIndex = Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 30) % 48

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('editor.title')}
      className={styles.wide}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" size="md" onClick={restoreOfficial}>{t('editor.restoreOfficial')}</Button>
          <Button variant="ghost" size="md" onClick={allOff}>{t('editor.allOff')}</Button>
          <span className={styles.footerSpacer} />
          <Button variant="ghost" size="md" onClick={onClose}>{t('modal.cancel')}</Button>
          <Button variant="primary" size="md" disabled={saving} onClick={() => void save()}>
            {saving ? t('settings.saving') : t('editor.save')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <span className={styles.tzLine}>{t('editor.localTz', { tz: `${utcOffsetLabel()} · ${systemTz || '—'}` })}</span>
        <span className={styles.hint}>{t('editor.hint')}</span>
        {error !== null && <div className={styles.error}>{error}</div>}

        {segments.length === 0 && (
          <div className={styles.empty}>{t('editor.empty')}</div>
        )}
        {segments.map((s, i) => (
          <div key={i} className={styles.row}>
            <select
              className={styles.input}
              value={s.level}
              onChange={(e) => patch(i, { level: e.target.value as SegmentDraft['level'] })}
            >
              <option value="peak">{t('editor.typePeak')}</option>
              <option value="off">{t('editor.typeOff')}</option>
            </select>
            <input type="time" className={styles.input} value={s.start} onChange={(e) => patch(i, { start: e.target.value })} />
            <span className={styles.dash}>–</span>
            <input type="time" className={styles.input} value={s.end} onChange={(e) => patch(i, { end: e.target.value })} />
            {daysLabel(s.days, t) !== null && <span className={styles.daysBadge}>{daysLabel(s.days, t)}</span>}
            <Button variant="ghost" size="sm" onClick={() => remove(i)}>{t('editor.remove')}</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setSegments((list) => [...list, { level: 'off', start: '22:00', end: '06:00' }])}>
          {t('editor.add')}
        </Button>

        <PriceBand segments={segments} nowIndex={nowIndex} t={t} />
      </div>
    </Modal>
  )
}
