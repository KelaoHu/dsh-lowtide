/**
 * Interface ⑥ LowtideSettings: the "闲时计划" settings section — batch
 * window editing (start/end, pause, limits, tz), peak/off/custom window
 * list editor (weekday toggles), price overrides, 24h band preview.
 * Saves through PUT /ds-lowtide/config and takes effect immediately
 * (next scheduler tick). All copy rides the `t` seat.
 */
import { useEffect, useState } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { getConfig, getStateMeta, updateConfig } from './api.ts'
import { refreshNow, showToast, switchLocale, useLowtide } from './store.ts'
import { type NsTranslate } from './i18n.ts'
import { PriceBand } from './components/PriceBand.tsx'
import styles from './settings.module.css'

interface WindowDraft {
  id: string
  label: string
  level: 'peak' | 'off' | 'custom'
  start: string
  end: string
  multiplier: string
  /** Comma-joined ISO weekdays (1=Mon … 7=Sun); empty = every day. */
  days: string
}

interface PriceRowDraft {
  input: string
  inputCached: string
  output: string
}

interface PriceTierDraft {
  peak: PriceRowDraft
  off: PriceRowDraft
}

interface Draft {
  start: string
  end: string
  tz: string
  paused: boolean
  gateLeadMin: string
  maxTasksPerNight: string
  maxDurationMin: string
  maxConcurrency: string
  autonomy: string
  budgetDailyYuan: string
  /** Report history cap; 0 = unlimited. */
  maxReportHistory: number
  windows: WindowDraft[]
  prices: Record<string, PriceTierDraft>
}

/** 官方忙时换算到本地时钟的段（来自 statePayload.officialInLocal）。 */
interface OfficialLocal {
  label: string
  start: string
  end: string
  crossesDay: boolean
  days?: number[]
}

function minutesOf(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (match === null) return Number.NaN
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return Number.NaN
  return h * 60 + m
}

/** 当前本地时区的 UTC 偏移标签,如 "UTC+8" / "UTC-5"。 */
function utcOffsetLabel(): string {
  const minutes = -new Date().getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '−'
  const abs = Math.abs(minutes)
  return `UTC${sign}${abs % 60 === 0 ? String(abs / 60) : `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`}`
}

function emptyPriceTier(): PriceTierDraft {
  return {
    peak: { input: '', inputCached: '', output: '' },
    off: { input: '', inputCached: '', output: '' },
  }
}

function windowToDraft(w: Record<string, unknown>): WindowDraft {
  return {
    id: typeof w.id === 'string' ? w.id : '',
    label: typeof w.label === 'string' ? w.label : '',
    level: w.level === 'peak' || w.level === 'off' ? w.level : 'custom',
    start: typeof w.start === 'string' ? w.start : '18:00',
    end: typeof w.end === 'string' ? w.end : '23:59',
    multiplier: typeof w.multiplier === 'number' ? String(w.multiplier) : '1',
    days: Array.isArray(w.days) ? w.days.join(',') : '',
  }
}

/** 复制窗口与价目覆盖(JSON),作为配置备份。 */
function configToJson(windows: WindowDraft[], prices: Record<string, PriceTierDraft>): string {
  const win = windows
    .filter((w) => w.id.trim() !== '' || w.label.trim() !== '')
    .map((w) => ({
      id: w.id.trim(),
      ...(w.label.trim() !== '' ? { label: w.label.trim() } : {}),
      level: w.level,
      start: w.start,
      end: w.end,
      ...(w.level === 'custom' ? { multiplier: Number(w.multiplier) || 1 } : {}),
      ...(w.days.trim() !== ''
        ? { days: w.days.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7) }
        : {}),
    }))
  const models = Object.keys(prices).filter((m) => prices[m].peak.input !== '' || prices[m].off.input !== '')
  const priceOut: Record<string, unknown> = {}
  for (const m of models) {
    const p = prices[m]
    priceOut[m] = {
      peak: {
        input: Number(p.peak.input) || 0,
        inputCached: Number(p.peak.inputCached) || 0,
        output: Number(p.peak.output) || 0,
      },
      off: {
        input: Number(p.off.input) || 0,
        inputCached: Number(p.off.inputCached) || 0,
        output: Number(p.off.output) || 0,
      },
    }
  }
  return JSON.stringify({ windows: win, prices: priceOut }, null, 2)
}

export function LowtideSettings({ t }: SettingsSectionOwnerProps & { t: NsTranslate }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmL3, setConfirmL3] = useState(false)
  const [pricesExpanded, setPricesExpanded] = useState(false)
  const activeLocale = useLowtide((s) => s.activeLocale)
  // 时区元信息(系统时区 + 官方忙时本地换算):用于官方定价说明与一键采用。
  const [meta, setMeta] = useState<{ systemTz: string; officialInLocal: OfficialLocal[] } | null>(null)

  useEffect(() => {
    let alive = true
    void getStateMeta().then((res) => {
      if (!alive) return
      if (res.ok) setMeta({ systemTz: res.systemTz ?? '', officialInLocal: res.officialInLocal ?? [] })
    }).catch(() => { /* 元信息非关键,失败仅影响说明卡片 */ })
    void getConfig().then((res) => {
      if (!alive) return
      if (!res.ok || res.config === undefined) {
        setError(t('settings.configError', { error: res.error ?? 'unknown' }))
        return
      }
      const c = res.config as Record<string, any>
      const batch = (c.batch ?? {}) as Record<string, any>
      const [start, end] = String(batch.window ?? '19:00-23:30').split('-')
      const prices: Record<string, PriceTierDraft> = {}
      if (c.prices !== undefined && typeof c.prices === 'object') {
        for (const [model, tier] of Object.entries(c.prices as Record<string, any>)) {
          prices[model] = {
            peak: {
              input: String(tier?.peak?.input ?? ''),
              inputCached: String(tier?.peak?.inputCached ?? ''),
              output: String(tier?.peak?.output ?? ''),
            },
            off: {
              input: String(tier?.off?.input ?? ''),
              inputCached: String(tier?.off?.inputCached ?? ''),
              output: String(tier?.off?.output ?? ''),
            },
          }
        }
      }
      setDraft({
        start: start ?? '19:00',
        end: end ?? '23:30',
        tz: typeof batch.tz === 'string' ? batch.tz : '',
        paused: batch.paused === true,
        gateLeadMin: String(typeof batch.gateLeadMin === 'number' ? batch.gateLeadMin : 30),
        maxTasksPerNight: String(typeof batch.maxTasksPerNight === 'number' ? batch.maxTasksPerNight : 10),
        maxDurationMin: String(typeof batch.maxDurationMin === 'number' ? batch.maxDurationMin : 240),
        maxConcurrency: String(typeof batch.maxConcurrency === 'number' ? batch.maxConcurrency : 3),
        autonomy: typeof c.autonomy === 'string' ? c.autonomy : 'l2',
        budgetDailyYuan: String(typeof c.budgetDailyYuan === 'number' ? c.budgetDailyYuan : 0),
        maxReportHistory: typeof c.maxReportHistory === 'number' ? c.maxReportHistory : 60,
        windows: Array.isArray(c.windows) ? c.windows.map(windowToDraft) : [],
        prices,
      })
    }).catch((reason) => {
      if (alive) setError(t('settings.configError', { error: reason instanceof Error ? reason.message : String(reason) }))
    })
    return () => { alive = false }
  }, [t])

  if (draft === null) return <div className={styles.loading}>{t('settings.loading')}</div>

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((d) => (d === null ? d : { ...d, [key]: value }))
  }

  function setWindow(index: number, patch: Partial<WindowDraft>): void {
    setDraft((d) => (d === null ? d : {
      ...d,
      windows: d.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }))
  }

  /** 已处于官方时段:窗口为空(空=官方回退,与显式采用等价)或草稿显式等于换算段(禁用"一键采用")。 */
  const officialAdopted = meta !== null && (
    draft.windows.length === 0
    || (
      meta.officialInLocal.length > 0
      && draft.windows.length === meta.officialInLocal.length
      && meta.officialInLocal.every((w) => draft.windows.some((d) => d.level === 'peak' && d.start === w.start && d.end === w.end))
    )
  )

  /** 一键采用:官方忙时本地换算段写入窗口草稿(level=peak,保存时自动生成 id)。
   *  days 跟随官方段(工作日 1-5),周末保持闲时。 */
  function adoptOfficial(): void {
    if (meta === null) return
    set('windows', meta.officialInLocal.map((w) => ({
      id: '',
      label: w.label,
      level: 'peak' as const,
      start: w.start,
      end: w.end,
      multiplier: '2',
      days: (w.days ?? []).join(','),
    })))
  }

  const pickAutonomy = (level: 'l1' | 'l2' | 'l3'): void => {
    if (level === 'l3' && draft.autonomy !== 'l3' && !confirmL3) {
      setConfirmL3(true)
      return
    }
    set('autonomy', level)
    setConfirmL3(false)
  }

  function setPrice(model: string, tier: 'peak' | 'off', field: keyof PriceRowDraft, value: string): void {
    setDraft((d) => (d === null ? d : {
      ...d,
      prices: {
        ...d.prices,
        [model]: {
          ...(d.prices[model] ?? emptyPriceTier()),
          [tier]: { ...(d.prices[model]?.[tier] ?? { input: '', inputCached: '', output: '' }), [field]: value },
        },
      },
    }))
  }

  function restoreDefaults(): void {
    setDraft((d) => (d === null ? d : {
      ...d,
      start: '19:00',
      end: '23:30',
      tz: '',
      paused: false,
      gateLeadMin: '30',
      maxTasksPerNight: '10',
      maxDurationMin: '240',
      maxConcurrency: '3',
      autonomy: 'l2',
      budgetDailyYuan: '0',
      // 默认跟随官方峰谷(周末全天闲时):显式写入官方段,与首次安装一致。
      windows: meta === null ? [] : meta.officialInLocal.map((w) => ({
        id: '',
        label: w.label,
        level: 'peak' as const,
        start: w.start,
        end: w.end,
        multiplier: '2',
        days: (w.days ?? []).join(','),
      })),
      prices: {},
    }))
    showToast(t('toast.restoredDefaults'))
  }

  const PRICE_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']
  const priceModels = [...new Set([...PRICE_MODELS, ...Object.keys(draft.prices)])]

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const daysOf = (s: string): number[] | undefined => {
      const days = s.split(',').map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
      return days.length > 0 ? days : undefined
    }
    const windows = draft.windows
      .filter((w) => w.label.trim() !== '')
      .map((w) => ({
        id: w.id.trim() === '' ? `win-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` : w.id.trim(),
        label: w.label.trim() === '' ? undefined : w.label.trim(),
        level: w.level,
        start: w.start,
        end: w.end,
        days: daysOf(w.days),
        multiplier: w.level === 'custom' ? Math.max(Number(w.multiplier) || 1, 0.01) : undefined,
      }))
    const prices: Record<string, unknown> = {}
    for (const [model, tier] of Object.entries(draft.prices)) {
      const has = tier.peak.input !== '' || tier.peak.inputCached !== '' || tier.peak.output !== ''
        || tier.off.input !== '' || tier.off.inputCached !== '' || tier.off.output !== ''
      if (!has) continue
      prices[model] = {
        peak: {
          input: Math.max(Number(tier.peak.input) || 0, 0),
          inputCached: Math.max(Number(tier.peak.inputCached) || 0, 0),
          output: Math.max(Number(tier.peak.output) || 0, 0),
        },
        off: {
          input: Math.max(Number(tier.off.input) || 0, 0),
          inputCached: Math.max(Number(tier.off.inputCached) || 0, 0),
          output: Math.max(Number(tier.off.output) || 0, 0),
        },
      }
    }
    const patch = {
      batch: {
        window: `${draft.start}-${draft.end}`,
        ...(draft.tz.trim() !== '' ? { tz: draft.tz.trim() } : {}),
        gateLeadMin: Math.max(Number(draft.gateLeadMin) || 0, 0),
        maxTasksPerNight: Math.max(Number(draft.maxTasksPerNight) || 1, 1),
        maxDurationMin: Math.max(Number(draft.maxDurationMin) || 1, 1),
        maxConcurrency: Math.min(Math.max(Number(draft.maxConcurrency) || 1, 1), 8),
        paused: draft.paused,
      },
      autonomy: draft.autonomy,
      budgetDailyYuan: Math.max(Number(draft.budgetDailyYuan) || 0, 0),
      maxReportHistory: Math.max(Number(draft.maxReportHistory) || 0, 0),
      windows,
      prices,
    }
    const res = await updateConfig(patch)
    setSaving(false)
    if (res.ok) {
      showToast(t('toast.saved'))
      refreshNow()
    } else {
      setError(t('toast.saveFailed', { error: res.error ?? 'unknown' }))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.onboarding}>
        <div className={styles.onboardingTitle}>{t('settings.onboardingTitle')}</div>
        <ol className={styles.onboardingSteps}>
          <li>{t('settings.step1')}</li>
          <li>{t('settings.step2')}</li>
          <li>{t('settings.step3')}</li>
          <li>{t('settings.step4')}</li>
        </ol>
      </div>

      <div className={styles.langRow}>
        <span className={styles.langLabel}>{t('settings.language')}</span>
        <div className={styles.pillRow}>
          <span
            className={`${styles.autonomyPill} ${activeLocale === 'zh' ? styles.autonomyActive : ''}`}
            onClick={() => { if (activeLocale !== 'zh') switchLocale() }}
          >
            中文
          </span>
          <span
            className={`${styles.autonomyPill} ${activeLocale === 'en' ? styles.autonomyActive : ''}`}
            onClick={() => { if (activeLocale !== 'en') switchLocale() }}
          >
            English
          </span>
        </div>
      </div>

      {error !== null && <div className={styles.error}>{error}</div>}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.batchTitle')}</h3>
        <div className={styles.grid}>
          <label className={styles.field}>{t('settings.start')}
            <input type="time" className={styles.input} value={draft.start} onChange={(e) => set('start', e.target.value)} />
          </label>
          <label className={styles.field}>{t('settings.end')}
            <input type="time" className={styles.input} value={draft.end} onChange={(e) => set('end', e.target.value)} />
          </label>
          <label className={styles.field}>{t('settings.tz')}
            <input type="text" className={styles.input} value={draft.tz} onChange={(e) => set('tz', e.target.value)} placeholder={meta?.systemTz ?? 'Asia/Shanghai'} />
          </label>
          <label className={styles.field}>{t('settings.gateLeadMin')}
            <input type="number" className={styles.input} min={0} value={draft.gateLeadMin} onChange={(e) => set('gateLeadMin', e.target.value)} />
          </label>
          <label className={styles.field}>{t('settings.maxTasksPerNight')}
            <input type="number" className={styles.input} min={1} value={draft.maxTasksPerNight} onChange={(e) => set('maxTasksPerNight', e.target.value)} />
          </label>
          <label className={styles.field}>{t('settings.maxDurationMin')}
            <input type="number" className={styles.input} min={1} value={draft.maxDurationMin} onChange={(e) => set('maxDurationMin', e.target.value)} />
          </label>
          <label className={styles.field}>{t('settings.maxConcurrency')}
            <input type="number" className={styles.input} min={1} max={8} value={draft.maxConcurrency} onChange={(e) => set('maxConcurrency', e.target.value)} />
          </label>
          <label className={styles.field}>{t('settings.budgetDailyYuan')}
            <input type="number" className={styles.input} min={0} value={draft.budgetDailyYuan} onChange={(e) => set('budgetDailyYuan', e.target.value)} />
            <span className={styles.strategyHint}>{t('settings.budgetHint')}</span>
          </label>
          <label className={styles.field}>{t('settings.autonomy')}
            <div className={styles.pillRow}>
              {(['l1', 'l2', 'l3'] as const).map((level) => (
                <span
                  key={level}
                  className={`${styles.autonomyPill} ${draft.autonomy === level ? styles.autonomyActive : ''}`}
                  onClick={() => pickAutonomy(level)}
                >
                  {level === 'l1' ? t('settings.l1') : level === 'l2' ? t('settings.l2') : t('settings.l3')}
                </span>
              ))}
            </div>
            {confirmL3 && (
              <div className={styles.confirmBox}>
                <span>{t('settings.l3Confirm')}</span>
                <button type="button" className={styles.confirmBtn} onClick={() => { set('autonomy', 'l3'); setConfirmL3(false) }}>{t('settings.confirm')}</button>
                <button type="button" className={styles.confirmCancel} onClick={() => setConfirmL3(false)}>{t('settings.cancel')}</button>
              </div>
            )}
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={draft.paused} onChange={(e) => set('paused', e.target.checked)} />
            {t('settings.paused')}
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.dataManagement')}</h3>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('settings.maxReportHistory')}</span>
          <div className={styles.pillRow}>
            {[0, 10, 30, 60, 100, 200].map((opt) => (
              <span
                key={opt}
                className={`${styles.autonomyPill} ${draft.maxReportHistory === opt ? styles.autonomyActive : ''}`}
                onClick={() => set('maxReportHistory', opt)}
              >
                {opt === 0 ? t('settings.unlimited') : opt}
              </span>
            ))}
          </div>
          <span className={styles.strategyHint}>{t('settings.maxReportHistoryHint')}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>{t('settings.windowsTitle')}</h3>
          <Button variant="ghost" size="sm" onClick={() => set('windows', [...draft.windows, { id: '', label: '', level: 'off', start: '22:00', end: '06:00', multiplier: '1', days: '' }])}>
            {t('settings.addWindow')}
          </Button>
        </div>

        {/* 官方定价说明:政策事实 + 本地换算 + 一键采用。 */}
        <div className={styles.officialCard}>
          <span className={styles.officialTitle}>{t('settings.officialTitle')}</span>
          <span className={styles.officialBody}>{t('settings.officialBody')}</span>
          {meta !== null && (
            <>
              <span className={styles.officialBody}>
                {t('settings.localTz', {
                  tz: `${utcOffsetLabel()} · ${meta.systemTz}`,
                })}
              </span>
              {meta.officialInLocal.length > 0 && (
                <span className={styles.officialBody}>
                  {t('settings.officialPeakLocal', {
                    range: meta.officialInLocal.map((w) => `${w.start}–${w.end}${w.crossesDay ? `（${t('settings.crossDay')}）` : ''}`).join('、'),
                  })}
                </span>
              )}
              <span className={styles.officialBody}>
                {t('settings.officialWeekend')}
              </span>
            </>
          )}
          <div className={styles.officialActions}>
            <Button
              variant="outline"
              size="sm"
              disabled={officialAdopted}
              onClick={adoptOfficial}
            >
              {officialAdopted ? t('settings.adoptAlready') : t('settings.adoptOfficial')}
            </Button>
          </div>
        </div>

        <p className={styles.hint}>{t('settings.localTimesHint')}{meta !== null && ` · ${meta.systemTz}`}</p>
        <p className={styles.hint}>{t('settings.windowsHint')}</p>
        {draft.windows.map((w, i) => (
          <div key={`${i}-${w.id}`} className={styles.windowRow}>
            <input type="text" className={styles.input} placeholder={t('settings.windowLabelName')} value={w.label} onChange={(e) => setWindow(i, { label: e.target.value })} />
            <select
              className={styles.input}
              value={w.level}
              onChange={(e) => setWindow(i, { level: e.target.value as WindowDraft['level'] })}
            >
              <option value="peak">{t('settings.windowLevelPeak')}</option>
              <option value="off">{t('settings.windowLevelOff')}</option>
              <option value="custom">{t('settings.windowLevelCustom')}</option>
            </select>
            <input type="time" className={styles.input} value={w.start} onChange={(e) => setWindow(i, { start: e.target.value })} />
            <input type="time" className={styles.input} value={w.end} onChange={(e) => setWindow(i, { end: e.target.value })} />
            {w.level === 'custom' && (
              <input type="number" className={styles.input} step="0.1" min={0.1} placeholder={t('settings.windowMultiplier')} value={w.multiplier} onChange={(e) => setWindow(i, { multiplier: e.target.value })} />
            )}
            <div className={styles.dayRow}>
              {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                const active = w.days.split(',').map((x) => Number(x.trim())).includes(day)
                const toggle = (): void => {
                  const current = w.days.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n))
                  const next = active ? current.filter((n) => n !== day) : [...current, day]
                  setWindow(i, { days: next.sort((a, b) => a - b).join(',') })
                }
                return (
                  <button
                    key={day}
                    type="button"
                    title={t('settings.windowDays')}
                    className={`${styles.dayBtn} ${active ? styles.dayActive : ''}`}
                    onClick={toggle}
                  >
                    {t(`settings.weekday${day}` as 'settings.weekday1')}
                  </button>
                )
              })}
            </div>
            <Button variant="ghost" size="sm" onClick={() => set('windows', draft.windows.filter((_, idx) => idx !== i))}>{t('settings.windowDelete')}</Button>
          </div>
        ))}
        {draft.windows.length === 0 && <div className={styles.noWindows}>{t('settings.noWindows')}</div>}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('settings.bandTitle')}</h3>
        <PriceBand
          segments={draft.windows.length > 0
            ? draft.windows.filter((w) => w.id.trim() !== '' || w.label.trim() !== '')
            : (meta?.officialInLocal ?? []).map((w) => ({ level: 'peak' as const, start: w.start, end: w.end }))}
          nowIndex={Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 30) % 48}
          t={t}
        />
        <div className={styles.legend}>
          <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.bandPeak}`} />{t('settings.bandPeak')}</span>
          <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.bandOff}`} />{t('settings.bandOff')}</span>
          <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.bandCustom}`} />{t('settings.bandCustom')}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>{t('settings.pricesTitle')}</h3>
          <Button variant="ghost" size="sm" onClick={() => setPricesExpanded(!pricesExpanded)}>
            {pricesExpanded ? t('settings.collapsePrices') : t('settings.expandPrices')}
          </Button>
        </div>
        <p className={styles.hint}>{t('settings.pricesHint')}</p>
        {pricesExpanded && (
          <>
            <div className={styles.priceTable}>
              <div className={styles.priceHead}>
                <span>{t('settings.priceModel')}</span><span>{t('settings.priceTier')}</span><span>{t('settings.priceInput')}</span><span>{t('settings.priceCached')}</span><span>{t('settings.priceOutput')}</span>
              </div>
              {priceModels.map((model) => (
                <PriceRowEditor
                  key={model}
                  model={model}
                  tier={draft.prices[model] ?? emptyPriceTier()}
                  onChange={setPrice}
                  t={t}
                />
              ))}
            </div>
            <p className={styles.hint}>{t('settings.exportHint')}</p>
          </>
        )}
      </section>

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <Button variant="ghost" size="md" onClick={restoreDefaults}>{t('settings.restore')}</Button>
          <Button variant="ghost" size="md" onClick={() => { void writeClipboard(configToJson(draft.windows, draft.prices)); showToast(t('toast.exported')) }}>
            {t('settings.export')}
          </Button>
        </div>
        <Button variant="primary" size="md" disabled={saving} onClick={() => void save()}>
          {saving ? t('settings.saving') : t('settings.save')}
        </Button>
      </div>
    </div>
  )
}

function PriceRowEditor({ model, tier, onChange, t }: {
  model: string
  tier: PriceTierDraft
  onChange: (model: string, t: 'peak' | 'off', field: keyof PriceRowDraft, value: string) => void
  t: NsTranslate
}): React.JSX.Element {
  const row = (tierKey: 'peak' | 'off'): React.JSX.Element => (
    <div className={styles.priceRow} key={tierKey}>
      <span className={styles.priceModel}>{model}</span>
      <span className={styles.priceTier}>{tierKey === 'peak' ? t('settings.priceTierPeak') : t('settings.priceTierOff')}</span>
      <input type="number" className={styles.input} min={0} step="0.1" value={tier[tierKey].input} placeholder="—"
        onChange={(e) => onChange(model, tierKey, 'input', e.target.value)} />
      <input type="number" className={styles.input} min={0} step="0.05" value={tier[tierKey].inputCached} placeholder="—"
        onChange={(e) => onChange(model, tierKey, 'inputCached', e.target.value)} />
      <input type="number" className={styles.input} min={0} step="0.1" value={tier[tierKey].output} placeholder="—"
        onChange={(e) => onChange(model, tierKey, 'output', e.target.value)} />
    </div>
  )
  return (
    <>
      {row('peak')}
      {row('off')}
    </>
  )
}
