import type { ChatModel, MessageUsage } from '../api/types.js'
import type { AssistantMessage, Message, ReplyRequestStats, TokenCharge } from './types.js'

export const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
export const CHARGE_UNITS_PER_YUAN = 100_000_000

// 每百万 tokens 的空闲价，单位为分。高峰价是空闲价的两倍。
const OFF_PEAK_RATES = {
  'deepseek-flash': { input: 100, cache: 2, output: 400 },
  'deepseek-v4-pro': { input: 450, cache: 15, output: 1350 },
} satisfies Record<ChatModel, { input: number; cache: number; output: number }>

// https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html
const HOLIDAYS_2026 = [
  [101, 103],
  [215, 223],
  [404, 406],
  [501, 505],
  [619, 621],
  [925, 927],
  [1001, 1007],
]

const getPriceTier = (timestamp: number): TokenCharge['tier'] => {
  const beijing = new Date(timestamp + 8 * 60 * 60 * 1000)
  const day = beijing.getUTCDay()
  const hour = beijing.getUTCHours()
  if (day === 0 || day === 6 || !((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))) {
    return 'offPeak'
  }
  if (beijing.getUTCFullYear() !== 2026) {
    return 'uncertain'
  }
  const date = (beijing.getUTCMonth() + 1) * 100 + beijing.getUTCDate()
  return HOLIDAYS_2026.some(([start, end]) => start <= date && date <= end) ? 'offPeak' : 'peak'
}

export const estimateTokenCharge = (
  model: ChatModel,
  usage: MessageUsage,
  sentAt: number,
  endedAt: number
): TokenCharge | undefined => {
  const rates = OFF_PEAK_RATES[model]
  // DeepSeek 当前只公布缓存读取价，写入量正常为 0。
  if (!rates || usage.cache_creation_input_tokens !== 0) {
    return undefined
  }
  const startedTier = getPriceTier(sentAt)
  const endedTier = getPriceTier(endedAt)
  const tier = startedTier === endedTier ? startedTier : 'uncertain'
  return {
    input: usage.input_tokens * rates.input,
    cacheRead: usage.cache_read_input_tokens * rates.cache,
    output: usage.output_tokens * rates.output,
    tier,
  }
}

export const getReplyRequests = (reply: AssistantMessage): ReplyRequestStats[] => {
  if (reply.requestStats) {
    return reply.requestStats
  }
  if (
    reply.status === 'pending' ||
    reply.status === 'streaming' ||
    reply.error?.kind === 'upload'
  ) {
    return []
  }
  // 旧版有时只保存 message_start 的用量，输出为零时无法与最终用量区分。
  return [{ usage: reply.usage && reply.usage.output_tokens > 0 ? reply.usage : undefined }]
}

const chargeKinds = ['input', 'cacheRead', 'output'] as const

export const summarizeUsage = (requests: Iterable<ReplyRequestStats>) => {
  const summary = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    metered: 0,
    unmetered: 0,
    priced: 0,
    unpriced: 0,
    charges: {
      input: { min: 0, max: 0 },
      cacheRead: { min: 0, max: 0 },
      output: { min: 0, max: 0 },
    },
  }
  for (const { usage, charge } of requests) {
    if (usage) {
      summary.metered += 1
      summary.input +=
        usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      summary.output += usage.output_tokens
      summary.cacheRead += usage.cache_read_input_tokens
      summary.cacheWrite += usage.cache_creation_input_tokens
    } else {
      summary.unmetered += 1
    }
    if (charge) {
      summary.priced += 1
      for (const kind of chargeKinds) {
        summary.charges[kind].min += charge[kind] * (charge.tier === 'peak' ? 2 : 1)
        summary.charges[kind].max += charge[kind] * (charge.tier === 'offPeak' ? 1 : 2)
      }
    } else {
      summary.unpriced += 1
    }
  }
  summary.total = summary.input + summary.output
  const minCharge = chargeKinds.reduce((sum, kind) => sum + summary.charges[kind].min, 0)
  const maxCharge = chargeKinds.reduce((sum, kind) => sum + summary.charges[kind].max, 0)
  return { ...summary, minCharge, maxCharge }
}

export type UsageSummary = ReturnType<typeof summarizeUsage>

export const summarizeSessionUsage = (messages: Message[]) =>
  summarizeUsage(
    messages.flatMap((message) => (message.role === 'assistant' ? getReplyRequests(message) : []))
  )
