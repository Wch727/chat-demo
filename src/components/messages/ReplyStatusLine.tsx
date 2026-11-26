import { useTranslate } from '../../i18n/index.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import {
  CHARGE_UNITS_PER_YUAN,
  getReplyRequests,
  PRICING_URL,
  summarizeUsage,
  type UsageSummary,
} from '../../services/chat/usage.js'
import styles from './ReplyStatusLine.module.css'

const countFormat = new Intl.NumberFormat()
const yuanFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
})
const count = (value: number) => countFormat.format(value)
const yuan = (units: number) => `¥${yuanFormat.format(units / CHARGE_UNITS_PER_YUAN)}`
const price = (min: number, max: number) => (min === max ? yuan(min) : `${yuan(min)}–${yuan(max)}`)
const cost = (usage: UsageSummary) => (usage.priced ? price(usage.minCharge, usage.maxCharge) : '—')
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`

export const formatSessionUsage = (usage: UsageSummary, t: ReturnType<typeof useTranslate>) =>
  t(usage.unmetered || usage.unpriced ? 'statusSessionPartial' : 'statusSession', {
    tokens: usage.metered ? count(usage.total) : '—',
    cost: cost(usage),
  })

export const ReplyStatusLine = ({
  message,
  sessionLabel,
}: {
  message: AssistantMessage
  sessionLabel: string
}) => {
  const t = useTranslate()
  const requests = getReplyRequests(message)
  const usage = summarizeUsage(requests)
  const elapsed = requests.reduce<number | undefined>(
    (total, request) =>
      request.elapsedMs === undefined ? total : (total ?? 0) + request.elapsedMs,
    undefined
  )
  const firstText = requests.find((request) => request.firstTextMs !== undefined)?.firstTextMs
  const cachePct = usage.input ? Math.round((100 * usage.cacheRead) / usage.input) : 0
  const { charges } = usage
  const fields = [
    [t('statusInput'), usage.metered ? count(usage.input) : '—'],
    [
      t('statusCacheMiss'),
      usage.metered ? count(usage.input - usage.cacheRead - usage.cacheWrite) : '—',
    ],
    [t('statusCacheRead'), usage.metered ? count(usage.cacheRead) : '—'],
    [t('statusCacheWrite'), usage.metered ? count(usage.cacheWrite) : '—'],
    [t('statusOutput'), usage.metered ? count(usage.output) : '—'],
    [t('statusTotal'), usage.metered ? count(usage.total) : '—'],
    [t('statusFirstText'), firstText === undefined ? '—' : seconds(firstText)],
  ]
  return (
    <details className={styles.status}>
      <summary className={styles.summary} aria-label={t('statusDetails')}>
        {elapsed === undefined ? null : (
          <span>{t('statusElapsed', { time: seconds(elapsed) })}</span>
        )}
        {usage.metered ? (
          <>
            <span>
              {t('statusInOut', { input: count(usage.input), output: count(usage.output) })}
            </span>
            <span className={styles.cache}>
              {t('statusCache', { tokens: count(usage.cacheRead), percent: cachePct })}
            </span>
          </>
        ) : (
          <span>{t('statusNoUsage')}</span>
        )}
        {usage.priced ? (
          <span>
            {t(usage.unpriced ? 'statusPartialCost' : 'statusCost', { cost: cost(usage) })}
          </span>
        ) : null}
        <span className={styles.session}>{sessionLabel}</span>
      </summary>
      <div className={styles.panel}>
        <dl className={styles.metrics}>
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {usage.priced ? (
          <p>
            {t('statusPriceBreakdown', {
              input: price(charges.input.min, charges.input.max),
              cache: price(charges.cacheRead.min, charges.cacheRead.max),
              output: price(charges.output.min, charges.output.max),
            })}
          </p>
        ) : null}
        {usage.unmetered ? <p>{t('statusMissingUsage', { count: usage.unmetered })}</p> : null}
        {usage.unpriced ? <p>{t('statusMissingCost', { count: usage.unpriced })}</p> : null}
        {usage.minCharge !== usage.maxCharge ? <p>{t('statusPriceRange')}</p> : null}
        <p>{t('statusSessionScope')}</p>
        <p>
          {t('statusPricingNote')}{' '}
          <a href={PRICING_URL} target="_blank" rel="noreferrer">
            {t('statusPricingLink')}
          </a>
        </p>
      </div>
    </details>
  )
}
