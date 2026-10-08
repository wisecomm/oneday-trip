import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui'
import { PlanListPage } from './PlanListPage'
import { RecommendPage } from './RecommendPage'

type Tab = 'course' | 'place'

const TABS: { key: Tab; label: string; subtitle: string }[] = [
  { key: 'course', label: '추천 코스', subtitle: '남이 짜 둔 하루를 그대로 가져올 수 있습니다' },
  { key: 'place', label: '추천 장소', subtitle: '시간 · 날씨 · 취향을 반영한 실시간 큐레이션' },
]

/**
 * 추천 탭 — 추천 코스(공용 플랜)와 추천 장소(맥락 추천 피드)를 한 곳에 둔다 (Q22).
 *
 * 예전에는 '추천'과 '플랜'이 따로 탭이었다. 둘 다 "남이 골라 준 것"인데 탭이
 * 갈라져 있으니 사용자가 차이를 짐작해야 했고, 탭이 6개라 라벨을 두 글자로
 * 묶어야 했다. 한 탭 안에서 하루 단위냐 장소 단위냐로 나누면 바로 읽힌다.
 *
 * 섞지 않고 나란히 둔다. 한 목록에서 같이 순위를 매기려면 장소와 코스를 같은
 * 점수로 재야 하는데, 그 점수식과 담은 수(clone_count) 누적이 아직 없다.
 * 나란히 두면 그 전제가 필요 없고, 나중에 섞을 길도 막히지 않는다.
 *
 * 회원과 비회원이 같은 화면을 본다. 두 하위 탭 모두 로그인 없이 열리고, 저장·
 * 담기처럼 내 데이터를 만드는 순간에만 로그인으로 보낸다. 코스는 공유 링크로
 * 들어오는 사람이 로그인 벽부터 만나면 공유가 성립하지 않아서, 장소는 같은
 * 탭 안에서 한쪽만 막히면 어색해서다.
 *
 * 고른 하위 탭은 주소(?tab=)에 남긴다. 상세로 갔다가 돌아와도 같은 탭이 열리고,
 * 링크로 특정 탭을 가리킬 수 있다. 탭을 바꾸는 것은 기록에 쌓지 않는다(replace)
 * — 뒤로 가기가 하위 탭 사이를 오가면 앱을 나가는 길이 길어진다.
 */
export function RecommendHubPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'place' ? 'place' : 'course'
  const current = TABS.find((t) => t.key === tab) ?? TABS[0]

  return (
    <>
      <PageHeader title="추천" subtitle={current.subtitle} />

      <div
        role="tablist"
        aria-label="추천 종류"
        className="flex gap-1 border-b border-ink-200/70 bg-white px-4 pt-1"
      >
        {TABS.map((t) => {
          const on = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`-mb-px border-b-2 px-3 pt-1.5 pb-2.5 text-[14.5px] font-bold transition-colors ${
                on ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-400'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'course' ? <PlanListPage embedded /> : <RecommendPage embedded />}
    </>
  )
}
