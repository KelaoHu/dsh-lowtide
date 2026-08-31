/**
 * PriceBand: 24h price-band preview — 48 cells (30 min each) colored by the
 * given segments, local-time axis labels, and a "now" marker. Shared by the
 * settings page and the pill's window editor (callers own the fallback: pass
 * official-in-local segments when nothing custom is configured).
 */
import { type NsTranslate } from '../i18n.ts'
import styles from './PriceBand.module.css'

export interface BandSegment {
  level: 'peak' | 'off' | 'custom'
  start: string
  end: string
}

function minutesOf(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (match === null) return Number.NaN
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return Number.NaN
  return h * 60 + m
}

export function PriceBand({ segments, nowIndex, t }: {
  segments: BandSegment[]
  nowIndex: number
  t: NsTranslate
}): React.JSX.Element {
  const cells = []
  for (let i = 0; i < 48; i++) {
    const start = i * 30
    let cls = styles.bandOff
    for (const w of segments) {
      const ws = minutesOf(w.start)
      const we = minutesOf(w.end)
      if (Number.isNaN(ws) || Number.isNaN(we)) continue
      const inWin = we > ws ? start >= ws && start < we : start >= ws || start < we
      if (inWin) {
        cls = w.level === 'peak' ? styles.bandPeak : w.level === 'custom' ? styles.bandCustom : styles.bandOff
        break
      }
    }
    const hh = String(Math.floor(start / 60)).padStart(2, '0')
    const mm = String(start % 60).padStart(2, '0')
    cells.push(
      <span
        key={i}
        className={`${styles.bandCell} ${cls} ${i === nowIndex ? styles.bandNow : ''}`}
        title={i === nowIndex ? t('settings.bandNow') : `${hh}:${mm}`}
      />,
    )
  }
  return (
    <div className={styles.bandWrap}>
      <div className={styles.bandAxis}>
        {['00:00', '06:00', '12:00', '18:00', '24:00'].map((h) => (
          <span key={h} className={styles.bandAxisLabel}>{h}</span>
        ))}
      </div>
      <div className={styles.band}>{cells}</div>
    </div>
  )
}
