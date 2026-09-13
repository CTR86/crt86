/* shared formatting helpers */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function fmtUsd(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null || !isFinite(n)) return '—'
  if (opts?.compact !== false && Math.abs(n) >= 10_000) return '$' + compactNum(n)
  if (n !== 0 && Math.abs(n) < 0.01) return '$' + n.toPrecision(3)
  return (
    '$' +
    n.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

export function compactNum(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toFixed(2)
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.001) return n.toFixed(5)
  // tiny prices: fixed notation with significant digits (no exponents on the CRT)
  const fixed = n.toFixed(14).replace(/0+$/, '')
  return fixed.endsWith('.') ? fixed.slice(0, -1) : fixed
}

export function fmtEth(wei: bigint, maxFrac = 6): string {
  const v = Number(wei) / 1e18
  if (v === 0) return '0'
  return v.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
}

export function shortAddr(a: string | null | undefined, size = 4): string {
  if (!a) return '—'
  if (a.length <= size * 2 + 3) return a
  return a.slice(0, size + 2) + '…' + a.slice(-size)
}

export function timeAgo(iso: string | number | Date | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

/** block-character progress bar, e.g. `██████░░░░ 60%` */
export function blocks(frac: number, width = 14): string {
  const f = Math.max(0, Math.min(1, frac))
  const filled = Math.round(f * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
