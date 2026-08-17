import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

/* ───────────────────────────── 헤더 ───────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string
  subtitle?: string
  back?: boolean
  right?: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-white/95 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-3">
        {back && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="뒤로"
            className="-ml-2 rounded-lg p-2 text-ink-600 hover:bg-ink-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold text-ink-800">{title}</h1>
          {subtitle && <p className="truncate text-[12px] text-ink-500">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  )
}

/* ───────────────────────────── 시트 ───────────────────────────── */

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-ink-900/40"
        onClick={onClose}
        role="presentation"
        aria-hidden
      />
      <div className="relative z-10 max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink-200" />
        {title && <h2 className="mb-3 text-[17px] font-bold text-ink-800">{title}</h2>}
        {children}
      </div>
    </div>
  )
}

/* ─────────────────────────── 빈 상태 ─────────────────────────── */

export function EmptyState({
  icon = '🗺️',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-4xl">{icon}</div>
      <p className="text-[15px] font-bold text-ink-700">{title}</p>
      {description && <p className="hint max-w-[300px]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ───────────────────────── 로딩 스피너 ───────────────────────── */

export function Loading({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
      <span className="text-[14px]">{label}</span>
    </div>
  )
}

/* ───────────────────── 스텝 가이드 인디케이터 ───────────────────── */

export function StepGuide({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-1.5">
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className="flex flex-1 items-center gap-1.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <div
                className={`h-1.5 rounded-full ${
                  done || active ? 'bg-brand-500' : 'bg-ink-200'
                }`}
              />
              <span
                className={`text-[11px] font-semibold ${
                  active ? 'text-brand-600' : 'text-ink-400'
                }`}
              >
                {s}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* ─────────────────────── 인원 수 스테퍼 ─────────────────────── */

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 12,
  unit = '명',
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  unit?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn-outline h-10 w-10 !px-0 text-xl"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="줄이기"
      >
        −
      </button>
      <span className="min-w-[64px] text-center text-[16px] font-bold text-ink-800">
        {value}
        {unit}
      </span>
      <button
        type="button"
        className="btn-outline h-10 w-10 !px-0 text-xl"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="늘리기"
      >
        +
      </button>
    </div>
  )
}
