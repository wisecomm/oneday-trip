import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { DELAY_STEP_MINUTES, MAX_DELAY_PER_DAY, waitings } from '@/lib/db'
import { estimatedWaitMinutes, MINUTES_PER_TEAM, useWaiting } from '@/store/waiting'
import type { Waiting } from '@/lib/types'
import { BottomSheet, EmptyState, Loading, PageHeader } from '@/components/ui'
import { PlaceThumb } from '@/components/PlaceCard'

/**
 * RSV-05-02 · 05. 예약 및 실시간 대기 > 5.2 웨이팅 / 대기 > 원격 줄서기 및 순서조절
 * '미루기'는 단순 순서 변경이 아니라 '대기 시간 +30분'이라는 직관적 시간 수치로 렌더링한다.
 * 악의적 점유 방지를 위해 하루 최대 2회로 제한한다.
 */
export function WaitingPage() {
  const { user } = useAuth()
  const { active, refresh } = useWaiting()
  const [history, setHistory] = useState<Waiting[]>([])
  const [loading, setLoading] = useState(true)
  const [guideOpen, setGuideOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const all = await waitings.listByUser(user.id)
      setHistory(all.filter((w) => w.status === 'cancelled' || w.status === 'done'))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(id)
  }, [notice])

  async function delay() {
    if (!active) return
    setBusy(true)
    try {
      const updated = await waitings.delay(active.id)
      if (!updated) {
        setNotice(`미루기는 하루 최대 ${MAX_DELAY_PER_DAY}회까지만 가능합니다.`)
      } else {
        setNotice(`대기 시간이 ${DELAY_STEP_MINUTES}분 늘어났습니다.`)
      }
      await refresh()
      setGuideOpen(false)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!active) return
    setBusy(true)
    try {
      await waitings.cancel(active.id)
      await refresh()
      await load()
      setNotice('대기를 취소했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />

  return (
    <>
      <PageHeader title="원격 웨이팅" subtitle="줄 서지 않고 순서를 관리하세요" back />

      <div className="px-4 py-4">
        {active ? (
          <ActiveWaitingBoard
            waiting={active}
            busy={busy}
            onDelayClick={() => setGuideOpen(true)}
            onCancel={cancel}
          />
        ) : (
          <EmptyState
            icon="⏱️"
            title="진행 중인 웨이팅이 없습니다"
            description="지도에서 마음에 드는 식당을 골라 원격으로 줄을 서 보세요."
            action={
              <Link to="/map" className="btn-primary">
                맛집 지도 열기
              </Link>
            }
          />
        )}

        {history.length > 0 && (
          <section className="mt-8">
            <h2 className="section-title mb-3">지난 웨이팅</h2>
            <ul className="flex flex-col gap-2">
              {history.map((w) => (
                <li key={w.id} className="card flex items-center gap-3 p-3">
                  {w.place && <PlaceThumb place={w.place} size={44} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-ink-800">{w.place?.name}</p>
                    <p className="text-[12px] text-ink-500">
                      {new Date(w.created_at).toLocaleString('ko-KR')} · {w.party_size}명
                    </p>
                  </div>
                  <span className="badge bg-ink-100 text-ink-500">
                    {w.status === 'cancelled' ? '취소됨' : '입장 완료'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* [웨이팅 미루기] 가이드 팝업 */}
      <BottomSheet open={guideOpen} onClose={() => setGuideOpen(false)} title="웨이팅 미루기">
        {active && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl bg-ink-100 p-4">
              <p className="text-[13px] font-semibold text-ink-600">미루면 이렇게 바뀝니다</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[22px] font-extrabold text-ink-400 line-through">
                  {estimatedWaitMinutes(active)}분
                </span>
                <span className="text-ink-400" aria-hidden>
                  →
                </span>
                <span className="text-[26px] font-extrabold text-brand-600">
                  {estimatedWaitMinutes(active) + DELAY_STEP_MINUTES + MINUTES_PER_TEAM * 2}분
                </span>
              </div>
              <p className="hint mt-2">
                순서만 뒤로 밀리는 것이 아니라, 예상 대기 시간이 {DELAY_STEP_MINUTES}분 늘어납니다.
              </p>
            </div>

            <div className="rounded-xl bg-amber-50 px-4 py-3">
              <p className="text-[13px] leading-relaxed font-semibold text-amber-800">
                오늘 남은 미루기 {MAX_DELAY_PER_DAY - active.delay_count}회 / 총 {MAX_DELAY_PER_DAY}회
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-amber-700">
                다른 손님의 대기 순서를 지키기 위해 하루 미루기 횟수를 제한하고 있습니다.
              </p>
            </div>

            <button
              type="button"
              onClick={delay}
              disabled={busy || active.delay_count >= MAX_DELAY_PER_DAY}
              className="btn-primary w-full"
            >
              +{DELAY_STEP_MINUTES}분 미루기
            </button>
            <button type="button" onClick={() => setGuideOpen(false)} className="btn-ghost w-full">
              그대로 기다리기
            </button>
          </div>
        )}
      </BottomSheet>

      {notice && (
        <div className="fixed inset-x-0 bottom-28 z-40 flex justify-center px-6">
          <p className="rounded-xl bg-ink-800 px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-lg">
            {notice}
          </p>
        </div>
      )}
    </>
  )
}

function ActiveWaitingBoard({
  waiting,
  busy,
  onDelayClick,
  onCancel,
}: {
  waiting: Waiting
  busy: boolean
  onDelayClick: () => void
  onCancel: () => void
}) {
  const minutes = estimatedWaitMinutes(waiting)

  return (
    <div>
      <div className="card overflow-hidden">
        <div className="bg-ink-800 px-5 py-6 text-center text-white">
          <p className="text-[13px] font-semibold text-ink-300">{waiting.place?.name}</p>
          <p className="mt-3 text-[13px] font-semibold text-ink-300">내 앞 대기</p>
          <p className="text-[44px] leading-none font-extrabold">
            {waiting.ahead_count}
            <span className="ml-1 text-[18px] font-bold">팀</span>
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3.5 py-1.5 text-[13px] font-bold">
            예상 대기 약 {minutes}분
          </p>
          {waiting.extra_minutes > 0 && (
            <p className="mt-2 text-[12px] font-semibold text-amber-300">
              미루기 {waiting.delay_count}회 · +{waiting.extra_minutes}분 반영됨
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 divide-x divide-ink-100 border-t border-ink-100 text-center">
          <Stat label="인원" value={`${waiting.party_size}명`} />
          <Stat label="신청 시각" value={new Date(waiting.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} />
          <Stat label="남은 미루기" value={`${MAX_DELAY_PER_DAY - waiting.delay_count}회`} />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDelayClick}
          disabled={busy || waiting.delay_count >= MAX_DELAY_PER_DAY}
          className="btn-outline flex-1"
        >
          웨이팅 미루기
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost flex-1">
          대기 취소
        </button>
      </div>

      {waiting.place && (
        <Link to={`/places/${waiting.place.id}`} className="btn-ghost mt-2 w-full">
          식당 상세 보기
        </Link>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-3">
      <p className="text-[11.5px] font-semibold text-ink-400">{label}</p>
      <p className="mt-0.5 text-[14px] font-bold text-ink-800">{value}</p>
    </div>
  )
}
