import type { MarketHoliday, Security } from './api'

export type SessionId =
  | 'US_EQUITIES_PRE_MARKET'
  | 'US_EQUITIES_REGULAR'
  | 'US_EQUITIES_POST_MARKET'
  | 'US_EQUITIES_OVERNIGHT'
  | 'CLOSED'

const SESSION_LABEL: Record<SessionId, string> = {
  US_EQUITIES_PRE_MARKET: 'PRE-MARKET',
  US_EQUITIES_REGULAR: 'REGULAR',
  US_EQUITIES_POST_MARKET: 'POST-MARKET',
  US_EQUITIES_OVERNIGHT: 'OVERNIGHT',
  CLOSED: 'CLOSED',
}

export function sessionLabel(id: SessionId): string {
  return SESSION_LABEL[id]
}

export interface NyClock {
  weekday: number /* 1=Mon … 7=Sun */
  minutes: number
  date: string /* YYYY-MM-DD in America/New_York */
}

export function nyClock(now = new Date()): NyClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  let hour = Number(g('hour'))
  if (hour === 24) hour = 0
  return {
    weekday: weekdayMap[g('weekday')] ?? 0,
    minutes: hour * 60 + Number(g('minute')),
    date: `${g('year')}-${g('month')}-${g('day')}`,
  }
}

function hm(h: number, m: number) {
  return h * 60 + m
}

function holidayClosed(clock: NyClock, holidays: MarketHoliday[]): MarketHoliday | null {
  const hit = holidays.find((h) => h.date === clock.date && (h.market === 'US_EQUITIES' || !h.market))
  if (!hit) return null
  const start = parseClock(hit.startTime) ?? 0
  const end = parseClock(hit.endTime) ?? hm(23, 59)
  if (clock.minutes >= start && clock.minutes <= end) return hit
  return null
}

function parseClock(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return hm(h, m)
}

export function currentSession(now = new Date(), holidays: MarketHoliday[] = []): SessionId {
  const c = nyClock(now)
  if (holidayClosed(c, holidays)) return 'CLOSED'
  const { weekday: wd, minutes: mins } = c
  if (wd >= 1 && wd <= 5) {
    if (mins >= hm(9, 30) && mins < hm(16, 0)) return 'US_EQUITIES_REGULAR'
    if (mins >= hm(4, 0) && mins < hm(9, 30)) return 'US_EQUITIES_PRE_MARKET'
    if (mins >= hm(16, 0) && mins < hm(20, 0)) return 'US_EQUITIES_POST_MARKET'
  }
  /* Overnight: Sun 20:00 → Thu 04:00 ET (Backpack US_EQUITIES_OVERNIGHT) */
  const overnightEvening = mins >= hm(20, 0) && (wd === 7 || wd === 1 || wd === 2 || wd === 3)
  const overnightMorning = mins < hm(4, 0) && (wd === 1 || wd === 2 || wd === 3 || wd === 4)
  if (overnightEvening || overnightMorning) return 'US_EQUITIES_OVERNIGHT'
  return 'CLOSED'
}

export function sessionForSecurity(sec: Security, session: SessionId) {
  if (session === 'CLOSED') return null
  return sec.sessions.find((s) => s.name === session) ?? null
}
