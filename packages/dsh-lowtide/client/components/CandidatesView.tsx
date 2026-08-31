/**
 * Sampling candidates view (PLAN v2 §1): the N independent results of a
 * sampling task, each with its own cost. The USER picks the best one the
 * next morning — the machine never auto-selects or merges. Shared by the
 * task detail modal and the execution report.
 */
import { useState } from 'react'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { chooseCandidate } from '../api.ts'
import { refreshNow, showToast, type HostCandidate } from '../store.ts'
import { type NsTranslate } from '../i18n.ts'
import { Money } from './atoms.tsx'
import styles from './CandidatesView.module.css'

export function CandidatesView({ candidates, chosenIndex, taskId, t }: {
  candidates: HostCandidate[]
  chosenIndex?: number
  taskId: string
  t: NsTranslate
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (candidates.length === 0) return <></>
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.toggle} onClick={() => setOpen(!open)}>
        {open ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
        {t('report.candidates', { count: candidates.length })}
      </button>
      {open && candidates.map((c, i) => {
        const picked = chosenIndex === i
        return (
          <div key={i} className={`${styles.candidate} ${picked ? styles.picked : ''}`}>
            <div className={styles.head}>
              <span className={styles.title}>{t('report.candidate', { index: i + 1 })}{picked && <span className={styles.pickedTag}>{t('report.picked')}</span>}</span>
              <span className={styles.meta}>
                {c.costYuan > 0
                  ? <><Money yuan={c.costYuan} /> · </>
                  : <>{t('report.priceUnknown')} · </>}
                {t('report.minutes', { minutes: Math.max(1, Math.round(c.elapsedMs / 60000)) })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={picked}
                onClick={() => {
                  void chooseCandidate(taskId, i).then((r) => {
                    if (r.ok) {
                      showToast(t('report.picked'))
                      refreshNow()
                    } else {
                      showToast(r.error ?? 'unknown')
                    }
                  })
                }}
              >
                {picked ? t('report.picked') : t('report.pickThis')}
              </Button>
            </div>
            <div className={styles.excerpt}>{c.excerpt}</div>
          </div>
        )
      })}
    </div>
  )
}
