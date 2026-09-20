import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, Readout } from '../design/ui'
import { play } from '../sound/sfx'

const SIZE = 400
const HIGH_KEY = 'crt86-shoot-high'
const PLAYER_Y = SIZE - 36
const PLAYER_R = 10
const FIRE_MS = 170
const INVULN_MS = 1500

interface Bullet {
  x: number
  y: number
  vy: number
  foe: boolean
  dead: boolean
}

interface Foe {
  x: number
  y: number
  vy: number
  drift: number
  phase: number
  hp: number
  kind: number // 0 scout · 1 weaver · 2 tank
  cool: number
  dead: boolean
}

interface Star {
  x: number
  y: number
  v: number
}

function readHigh(): number {
  try {
    return Number(localStorage.getItem(HIGH_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

function waveTarget(wave: number): number {
  return 6 + wave * 4
}

type Phase = 'ready' | 'running' | 'paused' | 'over'

export function ShootWindow() {
  const nav = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [wave, setWave] = useState(1)
  const [high, setHigh] = useState(readHigh)

  const pxRef = useRef(SIZE / 2)
  const keysRef = useRef<Set<string>>(new Set())
  const bulletsRef = useRef<Bullet[]>([])
  const foesRef = useRef<Foe[]>([])
  const starsRef = useRef<Star[]>([])
  const scoreRef = useRef(0)
  const livesRef = useRef(3)
  const waveRef = useRef(1)
  const killsRef = useRef(0)
  const spawnInRef = useRef(0)
  const fireInRef = useRef(0)
  const invulnUntilRef = useRef(0)
  const bannerUntilRef = useRef(0)
  const lastRef = useRef(0)

  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const draw = (now: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    g.fillStyle = '#05010d'
    g.fillRect(0, 0, SIZE, SIZE)
    // starfield
    g.fillStyle = 'rgba(157,127,212,0.7)'
    for (const s of starsRef.current) g.fillRect(s.x, s.y, 1.5, 1.5)
    // grid
    g.strokeStyle = 'rgba(106,63,181,0.18)'
    g.lineWidth = 1
    for (let x = 40; x < SIZE; x += 40) {
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, SIZE)
      g.stroke()
    }
    // foe bullets
    for (const b of bulletsRef.current) {
      if (!b.foe || b.dead) continue
      g.fillStyle = '#ff4d6d'
      g.shadowColor = '#ff4d6d'
      g.shadowBlur = 8
      g.fillRect(b.x - 2, b.y - 6, 4, 12)
      g.shadowBlur = 0
    }
    // player bullets
    for (const b of bulletsRef.current) {
      if (b.foe || b.dead) continue
      g.fillStyle = '#22d3ee'
      g.shadowColor = '#22d3ee'
      g.shadowBlur = 8
      g.fillRect(b.x - 1.5, b.y - 7, 3, 14)
      g.shadowBlur = 0
    }
    // foes
    for (const f of foesRef.current) {
      if (f.dead) continue
      const col = f.kind === 2 ? '#ff4d6d' : f.kind === 1 ? '#c084fc' : '#ffb000'
      g.fillStyle = col
      g.shadowColor = col
      g.shadowBlur = 8
      const w = f.kind === 2 ? 26 : 18
      const h = f.kind === 2 ? 16 : 12
      g.fillRect(f.x - w / 2, f.y - h / 2, w, h)
      g.shadowBlur = 0
      if (f.kind === 2 && f.hp < 3) {
        g.fillStyle = '#05010d'
        g.fillRect(f.x - w / 2 + 3, f.y - 2, (w - 6) * (f.hp / 3), 4)
      }
    }
    // player ship (blink while invulnerable)
    const invuln = now < invulnUntilRef.current
    if (!invuln || Math.floor(now / 120) % 2 === 0) {
      const x = pxRef.current
      const y = PLAYER_Y
      g.fillStyle = '#39ff14'
      g.shadowColor = '#39ff14'
      g.shadowBlur = 10
      g.beginPath()
      g.moveTo(x, y - 12)
      g.lineTo(x - 9, y + 8)
      g.lineTo(x, y + 3)
      g.lineTo(x + 9, y + 8)
      g.closePath()
      g.fill()
      g.shadowBlur = 0
    }
    // wave banner
    if (now < bannerUntilRef.current) {
      g.fillStyle = '#22d3ee'
      g.shadowColor = '#22d3ee'
      g.shadowBlur = 12
      g.font = '28px VT323, monospace'
      g.textAlign = 'center'
      g.fillText(`WAVE ${waveRef.current}`, SIZE / 2, SIZE / 2 - 10)
      g.shadowBlur = 0
    }
  }

  const gameOver = () => {
    setPhase('over')
    play('error')
    setHigh((h) => {
      const s = scoreRef.current
      if (s > h) {
        try {
          localStorage.setItem(HIGH_KEY, String(s))
        } catch {
          /* storage unavailable */
        }
        return s
      }
      return h
    })
  }

  const hurt = (now: number) => {
    if (now < invulnUntilRef.current) return
    livesRef.current -= 1
    setLives(livesRef.current)
    invulnUntilRef.current = now + INVULN_MS
    play('error')
    if (livesRef.current <= 0) gameOver()
  }

  const spawnFoe = () => {
    const w = waveRef.current
    const roll = Math.random()
    const kind = w >= 3 && roll < 0.18 ? 2 : roll < 0.45 ? 1 : 0
    foesRef.current.push({
      x: 20 + Math.random() * (SIZE - 40),
      y: -20,
      vy: (kind === 1 ? 1.15 : kind === 2 ? 0.55 : 0.8) * (1 + (w - 1) * 0.12),
      drift: kind === 1 ? 1.4 : 0.4,
      phase: Math.random() * Math.PI * 2,
      hp: kind === 2 ? 3 : 1,
      kind,
      cool: 1200 + Math.random() * 2200,
      dead: false,
    })
  }

  const update = (now: number, dt: number) => {
    const k = dt / 16.667 // frame-normalized step
    // stars
    for (const s of starsRef.current) {
      s.y += s.v * k
      if (s.y > SIZE) {
        s.y = -2
        s.x = Math.random() * SIZE
      }
    }
    // player movement
    const keys = keysRef.current
    const spd = 4.2 * k
    if (keys.has('left')) pxRef.current = Math.max(16, pxRef.current - spd)
    if (keys.has('right')) pxRef.current = Math.min(SIZE - 16, pxRef.current + spd)
    // auto-fire
    fireInRef.current -= dt
    if (fireInRef.current <= 0) {
      fireInRef.current = FIRE_MS
      bulletsRef.current.push({ x: pxRef.current, y: PLAYER_Y - 14, vy: -7, foe: false, dead: false })
    }
    // spawns — faster every wave
    spawnInRef.current -= dt
    if (spawnInRef.current <= 0) {
      spawnInRef.current = Math.max(280, 950 - (waveRef.current - 1) * 110)
      spawnFoe()
    }
    // foes
    const w = waveRef.current
    for (const f of foesRef.current) {
      if (f.dead) continue
      f.phase += 0.03 * k
      f.y += f.vy * k
      f.x += Math.sin(f.phase) * f.drift * k
      if (f.x < 12) f.x = 12
      if (f.x > SIZE - 12) f.x = SIZE - 12
      if (f.y > SIZE + 24) {
        f.dead = true
        continue
      }
      // foe fire from wave 2
      if (w >= 2) {
        f.cool -= dt
        if (f.cool <= 0 && f.y > 0 && f.y < SIZE * 0.6) {
          f.cool = 1600 + Math.random() * 2400 - Math.min(900, w * 120)
          bulletsRef.current.push({ x: f.x, y: f.y + 10, vy: 2.4 + w * 0.15, foe: true, dead: false })
        }
      }
      // ram check
      const dx = Math.abs(f.x - pxRef.current)
      const dy = Math.abs(f.y - PLAYER_Y)
      if (dx < PLAYER_R + 11 && dy < 14) {
        f.dead = true
        hurt(now)
      }
    }
    // bullets
    for (const b of bulletsRef.current) {
      if (b.dead) continue
      b.y += b.vy * k
      if (b.y < -20 || b.y > SIZE + 20) {
        b.dead = true
        continue
      }
      if (b.foe) {
        if (Math.abs(b.x - pxRef.current) < PLAYER_R && Math.abs(b.y - PLAYER_Y) < 12) {
          b.dead = true
          hurt(now)
        }
      } else {
        for (const f of foesRef.current) {
          if (f.dead) continue
          const hw = f.kind === 2 ? 13 : 9
          if (Math.abs(b.x - f.x) < hw + 2 && Math.abs(b.y - f.y) < 10) {
            b.dead = true
            f.hp -= 1
            if (f.hp <= 0) {
              f.dead = true
              killsRef.current += 1
              const pts = f.kind === 2 ? 50 : f.kind === 1 ? 20 : 10
              scoreRef.current += pts
              setScore(scoreRef.current)
              play('coin')
              if (killsRef.current >= waveTarget(waveRef.current)) {
                killsRef.current = 0
                waveRef.current += 1
                setWave(waveRef.current)
                bannerUntilRef.current = now + 2000
                play('alert')
              }
            }
            break
          }
        }
      }
    }
    if (bulletsRef.current.length > 220) bulletsRef.current = bulletsRef.current.filter((b) => !b.dead)
    else if (bulletsRef.current.some((b) => b.dead)) bulletsRef.current = bulletsRef.current.filter((b) => !b.dead)
    if (foesRef.current.some((f) => f.dead)) foesRef.current = foesRef.current.filter((f) => !f.dead)
  }

  const loopRef = useRef((now: number) => {
    void now
  })
  loopRef.current = (now: number) => {
    const dt = Math.min(50, now - (lastRef.current || now))
    lastRef.current = now
    if (phaseRef.current === 'running') {
      update(now, dt)
      draw(now)
    }
  }

  const start = () => {
    pxRef.current = SIZE / 2
    keysRef.current.clear()
    bulletsRef.current = []
    foesRef.current = []
    scoreRef.current = 0
    livesRef.current = 3
    waveRef.current = 1
    killsRef.current = 0
    spawnInRef.current = 400
    fireInRef.current = 0
    invulnUntilRef.current = 0
    bannerUntilRef.current = performance.now() + 2000
    lastRef.current = 0
    setScore(0)
    setLives(3)
    setWave(1)
    setPhase('running')
    play('click')
  }

  // main loop — single rAF, cancelled on unmount
  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      loopRef.current(now)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // seed starfield + paint idle board once
  useEffect(() => {
    starsRef.current = Array.from({ length: 70 }, () => ({
      x: Math.random() * SIZE,
      y: Math.random() * SIZE,
      v: 0.4 + Math.random() * 1.4,
    }))
    draw(0)
     
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'arrowleft' || k === 'a') {
        e.preventDefault()
        keysRef.current.add('left')
      } else if (k === 'arrowright' || k === 'd') {
        e.preventDefault()
        keysRef.current.add('right')
      } else if (k === 'arrowup' || k === 'w') {
        e.preventDefault()
      } else if (k === ' ') {
        e.preventDefault()
        if (phaseRef.current === 'running') {
          setPhase('paused')
          play('click')
        } else if (phaseRef.current === 'paused') {
          setPhase('running')
          play('click')
        }
      } else if (k === 'enter' && (phaseRef.current === 'ready' || phaseRef.current === 'over')) {
        start()
      }
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (k === 'arrowleft' || k === 'a') keysRef.current.delete('left')
      if (k === 'arrowright' || k === 'd') keysRef.current.delete('right')
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
     
  }, [])

  // touch: drag on the board to steer
  const steerTo = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * SIZE
    pxRef.current = Math.max(16, Math.min(SIZE - 16, x))
  }

  const holdBtn = (dir: 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      keysRef.current.add(dir)
    },
    onPointerUp: () => keysRef.current.delete(dir),
    onPointerLeave: () => keysRef.current.delete(dir),
    onPointerCancel: () => keysRef.current.delete(dir),
  })

  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <Panel title="SHOOT.EXE — STAR RANGER" end={<span className="pt-end">GAME.SYS</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <div className="grid-3" style={{ gap: 10, width: '100%' }}>
              <Readout label="SCORE" tone="green" value={score} />
              <Readout label="WAVE" tone="cyan" value={wave} />
              <Readout label="BEST" tone="amber" value={high} />
            </div>
            <div className="faint" style={{ fontSize: 16 }} aria-live="polite">
              HULL {'♥'.repeat(Math.max(0, lives)) || '—'}
            </div>
            <div style={{ position: 'relative', width: '100%', maxWidth: 440 }}>
              <canvas
                ref={canvasRef}
                width={SIZE}
                height={SIZE}
                className="scope"
                style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
                onTouchMove={(e) => {
                  if (e.touches[0]) steerTo(e.touches[0].clientX)
                }}
                onTouchStart={(e) => {
                  if (e.touches[0]) steerTo(e.touches[0].clientX)
                }}
              />
              {phase !== 'running' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'rgba(5,1,13,0.72)',
                    textAlign: 'center',
                    padding: 16,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                    <span className="t10" style={{ color: 'var(--green)', textShadow: 'var(--glow-green)' }}>
                      {phase === 'over' ? `GAME OVER — ${score} PTS` : phase === 'paused' ? 'PAUSED' : 'READY PLAYER ONE'}
                    </span>
                    {phase === 'over' && score >= high && score > 0 && (
                      <span className="t9" style={{ color: 'var(--amber)' }}>★ NEW BEST ★</span>
                    )}
                    <span className="faint" style={{ fontSize: 15 }}>
                      {phase === 'paused'
                        ? 'SPACE to resume · ◀ ▶ / A D to steer'
                        : '◀ ▶ / A D or drag to steer · auto-fire engaged · SPACE pauses · scouts 10 · weavers 20 · tanks 50'}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {phase === 'running' ? (
                <button className="bevel-btn" onClick={() => { setPhase('paused'); play('click') }}>❚❚ PAUSE</button>
              ) : (
                <button className="bevel-btn b-lg b-cyan" onClick={start}>
                  {phase === 'ready' ? '► START' : phase === 'paused' ? '► RESUME' : '↻ RETRY'}
                </button>
              )}
              {(phase === 'paused' || phase === 'over') && (
                <button className="bevel-btn" onClick={start}>↻ RESTART</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="bevel-btn b-sm" style={{ fontSize: 16, padding: '8px 18px' }} title="move left" {...holdBtn('left')}>◀</button>
              <button className="bevel-btn b-sm" style={{ fontSize: 16, padding: '8px 18px' }} title="move right" {...holdBtn('right')}>▶</button>
            </div>
          </div>
        </Panel>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>
    </div>
  )
}
