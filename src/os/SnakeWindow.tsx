import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel, Readout } from '../design/ui'
import { play } from '../sound/sfx'

const COLS = 20
const ROWS = 20
const SIZE = 400
const START_MS = 140
const MIN_MS = 70
const HIGH_KEY = 'crt86-snake-high'

interface Pt {
  x: number
  y: number
}

function randFood(snake: Pt[]): Pt {
  const taken = new Set(snake.map((p) => p.y * COLS + p.x))
  const free: number[] = []
  for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i)
  if (free.length === 0) return { x: 0, y: 0 }
  const pick = free[Math.floor(Math.random() * free.length)]
  return { x: pick % COLS, y: Math.floor(pick / COLS) }
}

function readHigh(): number {
  try {
    return Number(localStorage.getItem(HIGH_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

type Phase = 'ready' | 'running' | 'paused' | 'over'

export function SnakeWindow() {
  const nav = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const touchRef = useRef<{ x: number; y: number } | null>(null)
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState(0)
  const [high, setHigh] = useState(readHigh)
  const [speed, setSpeed] = useState(START_MS)

  const snakeRef = useRef<Pt[]>([])
  const dirRef = useRef<Pt>({ x: 1, y: 0 })
  const queueRef = useRef<Pt[]>([])
  const foodRef = useRef<Pt>({ x: 14, y: 10 })
  const foodsRef = useRef(0)
  const scoreRef = useRef(0)

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const g = canvas.getContext('2d')
    if (!g) return
    const cell = SIZE / COLS
    g.fillStyle = '#05010d'
    g.fillRect(0, 0, SIZE, SIZE)
    g.strokeStyle = 'rgba(106,63,181,0.18)'
    g.lineWidth = 1
    for (let x = 1; x < COLS; x++) {
      g.beginPath()
      g.moveTo(x * cell + 0.5, 0)
      g.lineTo(x * cell + 0.5, SIZE)
      g.stroke()
    }
    for (let y = 1; y < ROWS; y++) {
      g.beginPath()
      g.moveTo(0, y * cell + 0.5)
      g.lineTo(SIZE, y * cell + 0.5)
      g.stroke()
    }
    const f = foodRef.current
    g.fillStyle = '#ffb000'
    g.shadowColor = '#ffb000'
    g.shadowBlur = 10
    g.fillRect(f.x * cell + 3, f.y * cell + 3, cell - 6, cell - 6)
    g.shadowBlur = 0
    snakeRef.current.forEach((p, i) => {
      g.fillStyle = i === 0 ? '#7dff6a' : '#39ff14'
      g.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2)
    })
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

  const step = () => {
    const snake = snakeRef.current
    const head = snake[0]
    if (!head) return
    const next = queueRef.current.shift()
    if (next && !(next.x === -dirRef.current.x && next.y === -dirRef.current.y)) {
      dirRef.current = next
    }
    const nx = head.x + dirRef.current.x
    const ny = head.y + dirRef.current.y
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      gameOver()
      return
    }
    // moving into the tail tip is safe when not eating (tail moves away)
    const eating = nx === foodRef.current.x && ny === foodRef.current.y
    const body = eating ? snake : snake.slice(0, -1)
    if (body.some((p) => p.x === nx && p.y === ny)) {
      gameOver()
      return
    }
    const grown = [{ x: nx, y: ny }, ...snake]
    snakeRef.current = eating ? grown : grown.slice(0, -1)
    if (eating) {
      foodsRef.current += 1
      scoreRef.current += 10
      setScore(scoreRef.current)
      play('coin')
      if (foodsRef.current % 4 === 0) setSpeed((s) => Math.max(MIN_MS, s - 8))
      foodRef.current = randFood(snakeRef.current)
    }
    draw()
  }

  const stepRef = useRef(step)
  stepRef.current = step

  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const start = () => {
    const cy = Math.floor(ROWS / 2)
    snakeRef.current = [
      { x: 6, y: cy },
      { x: 5, y: cy },
      { x: 4, y: cy },
      { x: 3, y: cy },
    ]
    dirRef.current = { x: 1, y: 0 }
    queueRef.current = []
    foodsRef.current = 0
    scoreRef.current = 0
    setScore(0)
    setSpeed(START_MS)
    foodRef.current = randFood(snakeRef.current)
    setPhase('running')
    play('click')
    requestAnimationFrame(draw)
  }

  const pushDir = (d: Pt) => {
    const last = queueRef.current[queueRef.current.length - 1] ?? dirRef.current
    if (d.x === -last.x && d.y === -last.y) return
    if (d.x === last.x && d.y === last.y) return
    if (queueRef.current.length < 3) queueRef.current.push(d)
  }

  useEffect(() => {
    if (phase !== 'running') return
    const iv = setInterval(() => stepRef.current(), speed)
    return () => clearInterval(iv)
  }, [phase, speed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const map: Record<string, Pt> = {
        arrowup: { x: 0, y: -1 },
        w: { x: 0, y: -1 },
        arrowdown: { x: 0, y: 1 },
        s: { x: 0, y: 1 },
        arrowleft: { x: -1, y: 0 },
        a: { x: -1, y: 0 },
        arrowright: { x: 1, y: 0 },
        d: { x: 1, y: 0 },
      }
      if (map[k]) {
        e.preventDefault()
        pushDir(map[k])
        return
      }
      if (k === ' ') {
        e.preventDefault()
        if (phaseRef.current === 'running') {
          setPhase('paused')
          play('click')
        } else if (phaseRef.current === 'paused') {
          setPhase('running')
          play('click')
        }
      }
      if (k === 'enter' && (phaseRef.current === 'ready' || phaseRef.current === 'over')) {
        start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    draw()
  }, [])

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchRef.current
    touchRef.current = null
    if (!s) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
    pushDir(Math.abs(dx) > Math.abs(dy) ? { x: dx > 0 ? 1 : -1, y: 0 } : { x: 0, y: dy > 0 ? 1 : -1 })
  }

  const padBtn = (label: string, d: Pt, title: string) => (
    <button key={label} className="bevel-btn b-sm" style={{ fontSize: 16, padding: '8px 14px' }} title={title} onClick={() => pushDir(d)}>
      {label}
    </button>
  )

  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <Panel title="SNAKE.EXE — WIRE WORM" end={<span className="pt-end">GAME.SYS</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <div className="grid-2" style={{ gap: 10, width: '100%' }}>
              <Readout label="SCORE" tone="green" value={score} />
              <Readout label="BEST" tone="amber" value={high} />
            </div>
            <div
              style={{ position: 'relative', width: '100%', maxWidth: 440 }}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <canvas
                ref={canvasRef}
                width={SIZE}
                height={SIZE}
                className="scope"
                style={{ width: '100%', height: 'auto', display: 'block' }}
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
                      {phase === 'paused' ? 'SPACE to resume · arrows / WASD to steer' : 'Arrows / WASD / swipe to steer · SPACE pauses · +10 per byte, faster every 4'}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div>{padBtn('▲', { x: 0, y: -1 }, 'up')}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {padBtn('◀', { x: -1, y: 0 }, 'left')}
                {padBtn('▼', { x: 0, y: 1 }, 'down')}
                {padBtn('▶', { x: 1, y: 0 }, 'right')}
              </div>
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
