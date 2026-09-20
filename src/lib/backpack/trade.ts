/* Browser client for STOCK.EXE trading. Talks only to /api/bp.
   The ED25519 seed never leaves the server. When the proxy sets
   BP_OPERATOR_TOKEN, every call except status needs the operator
   token (stored browser-only, same as perp agent keys). */

const LS_BP_OPERATOR = 'crt86.bp.operator.v1'

export function loadBpOperatorToken(): string | null {
  try {
    const v = localStorage.getItem(LS_BP_OPERATOR)
    return v && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

export function saveBpOperatorToken(v: string): void {
  localStorage.setItem(LS_BP_OPERATOR, v.trim())
}

export function clearBpOperatorToken(): void {
  localStorage.removeItem(LS_BP_OPERATOR)
}

export interface BpStatus {
  configured: boolean
  name: string
  gated?: boolean
}

export interface BpBalance {
  available: string
  locked: string
  staked: string
}

export type BpBalances = Record<string, BpBalance>

export interface BpQuote {
  quoteId?: string
  rfqId?: string
  bidPrice?: string
  askPrice?: string
  status?: string
  [k: string]: unknown
}

export interface BpRfq {
  rfqId?: string
  id?: string
  symbol?: string
  side?: string
  quantity?: string
  status?: string
  [k: string]: unknown
}

export interface BpRfqRow {
  rfq: BpRfq
  quotes: BpQuote[]
}

function opHeaders(): Record<string, string> {
  const t = loadBpOperatorToken()
  return t ? { 'x-operator-token': t } : {}
}

async function bpGet<T>(op: string): Promise<T> {
  const r = await fetch(`/api/bp?op=${encodeURIComponent(op)}`, { headers: { ...opHeaders() } })
  const j = (await r.json().catch(() => ({}))) as { message?: string } & T
  if (!r.ok) throw new Error(j.message || `BP ${r.status}`)
  return j
}

async function bpPost<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/bp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opHeaders() },
    body: JSON.stringify(body),
  })
  const j = (await r.json().catch(() => ({}))) as { message?: string } & T
  if (!r.ok) throw new Error(j.message || `BP ${r.status}`)
  return j
}

export function getBpStatus() {
  return bpGet<BpStatus>('status')
}

export function getBpBalances() {
  return bpGet<BpBalances>('balances')
}

export function getBpRfqs() {
  return bpGet<BpRfqRow[]>('rfqs')
}

export function submitBpRfq(input: { symbol: string; side: 'Bid' | 'Ask'; quantity: string }) {
  return bpPost<BpRfq>({ op: 'rfq', ...input })
}

export function acceptBpQuote(input: { rfqId: string; quoteId: string }) {
  return bpPost<unknown>({ op: 'accept', ...input })
}

export function cancelBpRfq(rfqId: string) {
  return bpPost<unknown>({ op: 'cancel', rfqId })
}

export function rfqIdOf(row: BpRfqRow): string {
  return String(row.rfq.rfqId ?? row.rfq.id ?? '')
}

export function bestQuote(row: BpRfqRow): BpQuote | null {
  return row.quotes?.[0] ?? null
}
