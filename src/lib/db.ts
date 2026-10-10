import { isSupabaseConfigured, db as sb } from './supabase'
import { mutateDb, readDb, uid } from './local-store'
import { demo } from './demo-data'
import { DAY_TRIP_RADIUS_KM, distanceKm, type LatLng } from './geo'
import { rankAll, takePage, tieHash } from './recommend'
import type {
  Place,
  PlaceCategory,
  PlanHiddenReason,
  Profile,
  Region,
  RegionGroup,
  PlanRating,
  Season,
  SharedPlan,
  SharedPlanItem,
  Trip,
  TripItem,
  TripItemStatus,
} from './types'

/**
 * 데이터 접근 계층.
 * 모든 화면은 이 모듈만 호출하며, Supabase 연결 여부에 따른 분기는 여기서만 일어난다.
 */

const nowIso = () => new Date().toISOString()

/* ─────────────────── Region groups · regions (TRIP-02-01) ─────────────────── */

/**
 * 미판정 지역·장소는 어디에도 보이지 않는다.
 *
 * 판정에 실패한 장소는 버리거나 가까운 구에 욱여넣지 않고 코드 -1 로 격리해
 * 수동 처리 대기열에 둔다. 모든 화면이 이 모듈만 통해 읽으므로, 제외 조건은
 * 여기 두 곳에만 있으면 된다.
 */
const visibleRegion = <T extends { tour_sigungu_code: number }>(r: T) =>
  r.tour_sigungu_code >= 0

export const regionGroups = {
  async list(): Promise<RegionGroup[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('region_groups')
        .select('*')
        .gte('tour_area_code', 0)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as RegionGroup[]
    }
    return demo.groups.filter((g) => g.tour_area_code >= 0)
  },
}

export const regions = {
  /** 하위(시군구) 전체. tour_area_code 로 걸러 상위 지역에 속한 것만 골라 쓴다 */
  async list(): Promise<Region[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('regions')
        .select('*')
        .gte('tour_sigungu_code', 0)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as Region[]
    }
    return demo.regions.filter(visibleRegion)
  },
}

/* ───────────────────────── Places (MAP-04-01) ───────────────────────── */

export interface PlaceFilter {
  /** 상위 지역(시/도). 이것만 주면 그 시/도 전체를 본다 */
  areaCode?: number
  /** 하위 지역(시군구). areaCode 와 함께 준다 */
  sigunguCode?: number
  categories?: PlaceCategory[]
  keyword?: string
}

/**
 * Supabase 조회에 지역 이름을 함께 가져오는 select.
 *
 * 화면마다 코드→이름 변환을 부르게 하면 어딘가는 반드시 놓친다 — 실제로
 * share-card.ts 가 지역 이름을 인스타그램 해시태그로 쓰고 있어서, 놓치면
 * 사용자 게시물에 코드 숫자가 나간다. 조회 결과에 이름을 실어 보내면
 * 표시 지점이 알아서 안전해진다.
 */
const PLACE_SELECT = '*, region:regions!inner(name, group:region_groups!inner(name))'

type PlaceRow = Omit<Place, 'region_name' | 'group_name'> & {
  region?: { name: string; group?: { name: string } | null } | null
}

const flattenPlace = (row: PlaceRow): Place => ({
  ...(row as unknown as Place),
  region_name: row.region?.name ?? '',
  group_name: row.region?.group?.name ?? '',
})

/** 장소 목록을 나눠 받을 때 한 번에 요청하는 행 수 — 서버 상한(max_rows)과 같게 둔다 */
const PLACE_PAGE_ROWS = 1000

export const places = {
  async list(filter: PlaceFilter = {}): Promise<Place[]> {
    if (isSupabaseConfigured) {
      const query = (withCount: boolean) => {
        let q = sb()
          .from('places')
          .select(PLACE_SELECT, withCount ? { count: 'exact' } : undefined)
          // 미판정 장소는 목록에 넣지 않는다
          .gte('tour_sigungu_code', 0)
          // TourAPI 에서 표출 중단된 장소도 — 이미 담긴 일정에서는 get · 조인으로 그대로 연다
          .is('hidden_at', null)
        if (filter.areaCode !== undefined) q = q.eq('tour_area_code', filter.areaCode)
        if (filter.sigunguCode !== undefined) q = q.eq('tour_sigungu_code', filter.sigunguCode)
        if (filter.categories?.length) q = q.in('category', filter.categories)
        if (filter.keyword) q = q.ilike('name', `%${filter.keyword}%`)
        // 이름순 — 화면이 순서를 다시 매기기 전의 예측 가능한 기본값이다.
        // 이름이 같은 장소가 있어 id 로 끝까지 순서를 고정한다 — 나눠 받을 때 순서가
        // 흔들리면 쪽 사이에서 장소가 빠지거나 두 번 온다.
        return q.order('name').order('id')
      }

      // API 는 한 번에 최대 1,000행(config.toml max_rows)만 돌려주고, 넘쳐도 오류 없이
      // 잘라 버린다. 경기(3,357곳)처럼 '시/도 전체'가 상한을 넘는 곳이 7곳이라
      // 첫 쪽에서 전체 개수를 받고 나머지 쪽을 한꺼번에 받는다. 쪽 크기는 첫 쪽이 실제로
      // 돌려준 행 수 — 운영 서버의 상한이 1,000 보다 작아도 그 크기로 이어 받는다.
      const first = await query(true).range(0, PLACE_PAGE_ROWS - 1)
      if (first.error) throw first.error
      const rows = [...((first.data ?? []) as unknown as PlaceRow[])]
      const total = first.count ?? rows.length
      const step = rows.length
      if (step > 0 && rows.length < total) {
        const offsets: number[] = []
        for (let from = step; from < total; from += step) offsets.push(from)
        const pages = await Promise.all(offsets.map((from) => query(false).range(from, from + step - 1)))
        for (const page of pages) {
          if (page.error) throw page.error
          rows.push(...((page.data ?? []) as unknown as PlaceRow[]))
        }
      }
      return rows.map(flattenPlace)
    }

    const ratings = demoPlaceRatings()
    return demo.places.map((p) => withDemoRating(p, ratings)).filter((p) => {
      if (p.tour_sigungu_code < 0) return false
      if (p.hidden_at) return false
      if (filter.areaCode !== undefined && p.tour_area_code !== filter.areaCode) return false
      if (filter.sigunguCode !== undefined && p.tour_sigungu_code !== filter.sigunguCode)
        return false
      if (filter.categories?.length && !filter.categories.includes(p.category)) return false
      if (filter.keyword && !p.name.includes(filter.keyword)) return false
      return true
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  },

  /**
   * 내 위치에서 가까운 순 limit 곳 — 지도 '↻ 내 위치 다시 찾기'.
   *
   * 하루 거리(maxKm, 120km) 안을 통째로 받으면 수도권에서 7,000곳 가까이 돼 지도가 점으로
   * 뒤덮인다. DB 함수 places_nearest 가 거리를 재서 가까운 순으로 자른 limit 곳만 돌려준다 —
   * 한 번 묻는다(API 는 계산한 거리로 정렬할 수 없다). 지역 이름은 평소처럼 select 로 붙인다.
   * maxKm 안에 limit 곳이 없으면 있는 만큼.
   *
   * km 는 돌려준 마지막(가장 먼) 곳까지의 거리 — 화면이 '가까운 100곳 · 3.2km 안'으로 쓴다.
   */
  async nearest(
    at: LatLng,
    opts: { limit: number; maxKm: number; categories?: PlaceCategory[] },
  ): Promise<{ places: Place[]; km: number }> {
    let found: Place[]
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .rpc('places_nearest', {
          p_lat: at.lat,
          p_lng: at.lng,
          p_limit: opts.limit,
          p_max_km: opts.maxKm,
          p_categories: opts.categories?.length ? opts.categories : null,
        })
        .select(PLACE_SELECT)
      if (error) throw error
      found = ((data ?? []) as unknown as PlaceRow[]).map(flattenPlace)
    } else {
      const ratings = demoPlaceRatings()
      found = demo.places
        .filter(
          (p) =>
            p.tour_sigungu_code >= 0 &&
            !p.hidden_at &&
            (!opts.categories?.length || opts.categories.includes(p.category)) &&
            distanceKm(at, p) <= opts.maxKm,
        )
        .map((p) => withDemoRating(p, ratings))
    }
    // 서버가 정렬해 오지만, 지역 이름을 붙이는 조인 뒤에도 순서가 남는다는 약속은 없어 다시 맞춘다
    const ranked = found
      .map((place) => ({ place, d: distanceKm(at, place) }))
      .sort((a, b) => a.d - b.d || (a.place.id < b.place.id ? -1 : 1))
      .slice(0, opts.limit)
    return { places: ranked.map((x) => x.place), km: ranked.at(-1)?.d ?? 0 }
  },

  async get(id: string): Promise<Place | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('places')
        .select(PLACE_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data ? flattenPlace(data as unknown as PlaceRow) : null
    }
    const found = demo.places.find((p) => p.id === id)
    return found ? withDemoRating(found, demoPlaceRatings()) : null
  },

  /**
   * 홈 '하루에 다녀올 만한 곳' (플로챠트/홈.md) — 처음 10곳, '더 보기'는 보인 곳(exclude)을 빼고 다음 10곳.
   *
   * 종류 비율 없이 한 줄 순서: 하루 거리 안의 리뷰 있는 곳(평균 → 개수 → 거리), 그다음 가까운 순.
   * 술집 · 숨긴 장소 · 미판정 제외. 고르는 일은 DB 함수 home_picks 가 하고 id 와 순서만 돌려준다 —
   * 장소 전체를 받아 브라우저에서 고르면 API 상한(1,000행)에 잘린다. 이름 · 지역 이름은 평소
   * 조회로 붙인다. base 가 null 이면 DB 함수가 서울 강남구 중심을 쓴다.
   */
  async homePicks(base: LatLng | null, count = 10, exclude: string[] = []): Promise<Place[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().rpc('home_picks', {
        p_lat: base?.lat ?? null,
        p_lng: base?.lng ?? null,
        p_count: count,
        p_exclude: exclude,
      })
      if (error) throw error
      return placesInPickOrder(data)
    }
    const skip = new Set(exclude)
    return demoHomeOrder(base)
      .filter((c) => !skip.has(c.place.id))
      .slice(0, count)
      .map((c) => c.place)
  },
}

/**
 * 추천 장소 한 쪽 — 지역 장소를 별점 점수로 매겨 count 곳(보인 곳 exclude 는 빼고). 점수 · 고르는 규칙은
 * recommend.ts 의 ratingScore() · takePage() 와 같고, 운영은 DB 함수 recommend_places 가 매겨
 * 고른 id 만 돌려준다 — 지역 장소 전부를 받아 브라우저에서 매기던 것(경기 3,357곳)을 10곳으로.
 * seed 가 같으면 동점 순서가 같아 쪽을 넘겨도 흔들리지 않는다. total 은 지역 후보 전체 수.
 */
export async function recommendPlaces(opts: {
  areaCode: number
  sigunguCode?: number
  exclude: string[]
  count: number
  seed: string
}): Promise<{ places: Place[]; total: number }> {
  if (isSupabaseConfigured) {
    const { data, error } = await sb().rpc('recommend_places', {
      p_area: opts.areaCode,
      p_sigungu: opts.sigunguCode ?? null,
      p_exclude: opts.exclude,
      p_count: opts.count,
      p_seed: opts.seed,
    })
    if (error) throw error
    const rows = (data ?? []) as { place_id: string; pick_order: number; total: number }[]
    return {
      places: await placesInPickOrder(rows),
      // 남은 곳이 없으면 행이 없어 total 을 못 받는다 — 이미 본 만큼이 전부다
      total: rows[0]?.total ?? opts.exclude.length,
    }
  }
  const all = await places.list({ areaCode: opts.areaCode, sigunguCode: opts.sigunguCode })
  const skip = new Set(opts.exclude)
  const ranked = rankAll(
    all.filter((p) => !skip.has(p.id)),
    (id) => tieHash(opts.seed, id),
  )
  return { places: takePage(ranked, opts.count).page.map((r) => r.place), total: all.length }
}

/** 홈 DB 함수가 돌려준 id · 순서에 장소 행(지역 이름 포함)을 붙여 그 순서대로 */
async function placesInPickOrder(data: unknown): Promise<Place[]> {
  const picks = ((data ?? []) as { place_id: string; pick_order: number }[]).sort(
    (a, b) => a.pick_order - b.pick_order,
  )
  if (picks.length === 0) return []
  const { data: rows, error } = await sb()
    .from('places')
    .select(PLACE_SELECT)
    .in(
      'id',
      picks.map((x) => x.place_id),
    )
  if (error) throw error
  const byId = new Map(
    ((rows ?? []) as unknown as PlaceRow[]).map(flattenPlace).map((pl) => [pl.id, pl]),
  )
  return picks.map((x) => byId.get(x.place_id)).filter((pl): pl is Place => pl !== undefined)
}

/* ── 데모 모드의 홈 선택 — DB 함수 home_picks 와 같은 규칙 ── */

/**
 * 데모 저장소의 리뷰로 장소 별점을 그 자리에서 계산한다. 데모에는 DB 트리거가
 * 없고 장소 목록도 코드에 박힌 값이라 저장해 둘 곳이 없어서다. 규칙은 DB 의
 * place_rating_recompute 와 같다 — 사람당 한 표, 가장 최근 여행의 별점.
 */
function demoPlaceRatings(): Map<string, { rating_avg: number; rating_count: number }> {
  const d = readDb()
  const tripOf = new Map(d.trips.map((t) => [t.id, t]))
  const latest = new Map<string, { rating: number; date: string; created: string; id: string }>()
  for (const it of d.trip_items) {
    if (it.rating == null) continue
    const t = tripOf.get(it.trip_id)
    if (!t) continue
    const key = `${it.place_id}|${t.user_id}`
    const cur = latest.get(key)
    const cand = { rating: it.rating, date: t.trip_date, created: t.created_at, id: it.id }
    const newer =
      !cur ||
      cand.date > cur.date ||
      (cand.date === cur.date &&
        (cand.created > cur.created || (cand.created === cur.created && cand.id > cur.id)))
    if (newer) latest.set(key, cand)
  }
  const sum = new Map<string, { s: number; n: number }>()
  for (const [key, v] of latest) {
    const placeId = key.slice(0, key.lastIndexOf('|'))
    const cur = sum.get(placeId) ?? { s: 0, n: 0 }
    sum.set(placeId, { s: cur.s + v.rating, n: cur.n + 1 })
  }
  return new Map(
    [...sum].map(([id, v]) => [id, { rating_avg: Math.round((v.s / v.n) * 10) / 10, rating_count: v.n }]),
  )
}

/** 데모 장소에 기기 리뷰로 계산한 별점을 붙인다 — 데모 장소 목록은 코드에 박힌 값이라 */
function withDemoRating(
  p: Place,
  ratings: Map<string, { rating_avg: number; rating_count: number }>,
): Place {
  return { ...p, ...(ratings.get(p.id) ?? { rating_avg: null, rating_count: 0 }) }
}

/** 홈 후보 종류 — 술집은 넣지 않는다 */
const HOME_CATEGORIES: PlaceCategory[] = ['spot', 'babzip', 'cafe']

/** 데모 홈 후보 전체를 DB 함수 home_picks 와 같은 순서로 */
function demoHomeOrder(base: LatLng | null) {
  const ratings = demoPlaceRatings()
  const gangnam = demo.regions.find((r) => r.tour_area_code === 1 && r.tour_sigungu_code === 1)
  const origin = base ?? (gangnam ? { lat: gangnam.lat, lng: gangnam.lng } : null)
  const cand = demo.places
    .filter((p) => p.tour_sigungu_code >= 0 && !p.hidden_at && HOME_CATEGORIES.includes(p.category))
    .map((p) => {
      const place = withDemoRating(p, ratings)
      const km = origin ? distanceKm(origin, p) : 0
      return { place, km, reviewed: place.rating_count > 0 && km <= DAY_TRIP_RADIUS_KM }
    })
  // home_picks 와 같은 순서: 리뷰 묶음(평균 → 개수 → 거리) 다음 나머지(거리)
  const order = (a: (typeof cand)[number], b: (typeof cand)[number]) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? -1 : 1
    if (a.reviewed) {
      const d =
        (b.place.rating_avg ?? 0) - (a.place.rating_avg ?? 0) ||
        b.place.rating_count - a.place.rating_count
      if (d) return d
    }
    return a.km - b.km || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0)
  }
  return cand.sort(order)
}

/* ─────────────────────── Profiles (SYS-01-02) ─────────────────────── */

export const profiles = {
  async get(userId: string): Promise<Profile | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return (data as Profile) ?? null
    }
    return readDb().profiles.find((p) => p.id === userId) ?? null
  },

  /**
   * 역할(`role`)은 여기서 넘기지 않는다. 화면에서 보낼 수 있게 두면 온보딩
   * 요청에 `role: 'admin'` 을 실어 보내는 길이 열린다. 관리자 임명은 SQL 로만 한다.
   */
  async upsert(
    input: Omit<Profile, 'created_at' | 'role' | 'language'> & { language?: Profile['language'] },
  ): Promise<Profile> {
    const row: Profile = { language: 'ko', ...input, role: 'user', created_at: nowIso() }

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('profiles')
        .upsert({
          id: input.id,
          nickname: input.nickname,
          taste_tags: input.taste_tags,
          // 언어는 넘겼을 때만 — 프로필을 고칠 때 화면 언어가 기본값으로 되돌아가지 않게
          ...(input.language ? { language: input.language } : {}),
        })
        .select()
        .single()
      if (error) throw error
      return data as Profile
    }

    /*
     * 저장한 것과 돌려주는 것이 같아야 한다. 기존 행이 있으면 저장 쪽은
     * `role` 과 `created_at` 을 지키는데, 예전에는 돌려주는 값이 늘 새로 만든
     * row(= role 'user', created_at 지금) 였다. 화면이 그 둘을 쓰지 않아
     * 드러나지 않았을 뿐, 데모에 운영자가 생기면 취향 태그만 고쳐도 화면에서
     * 권한이 사라지는 종류의 어긋남이다.
     */
    let saved = row
    mutateDb((d) => {
      const i = d.profiles.findIndex((p) => p.id === input.id)
      if (i >= 0) {
        saved = { ...d.profiles[i], ...input }
        d.profiles[i] = saved
      } else {
        d.profiles.push(row)
      }
    })
    return saved
  },

  /** 화면 언어만 바꾼다(MY · 언어). 프로필이 아직 없으면(온보딩 전) 아무것도 하지 않는다 */
  async setLanguage(userId: string, language: Profile['language']): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('profiles').update({ language }).eq('id', userId)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.profiles.findIndex((p) => p.id === userId)
      if (i >= 0) d.profiles[i] = { ...d.profiles[i], language }
    })
  },
}

/* ───────────────── Trips (TRIP-02-01 / TRIP-02-02) ───────────────── */

/**
 * 저장할 때는 코드만 넘긴다. 이름은 조회 시 조인해서 채운다.
 * `source_plan_id` 는 담기로 만들어질 때만 채워지므로 선택이다.
 * `published_plan_id` 는 받지 않는다 — 공유할 때 publishFromTrip 만 채운다.
 */
export type TripInput = Omit<
  Trip,
  'id' | 'created_at' | 'group_name' | 'region_name' | 'source_plan_id' | 'published_plan_id'
> & { source_plan_id?: string | null }

/** 여행도 장소와 같은 이유로 지역 이름을 함께 가져온다 */
const TRIP_SELECT = '*, group:region_groups!inner(name), region:regions(name)'

type TripRow = Omit<Trip, 'group_name' | 'region_name'> & {
  group?: { name: string } | null
  region?: { name: string } | null
}

const flattenTrip = (row: TripRow): Trip => ({
  ...(row as unknown as Trip),
  group_name: row.group?.name ?? '',
  region_name: row.region?.name ?? null,
})

/** 데모 모드에서는 조인이 없으니 지역 배열에서 이름을 찾아 붙인다 */
function demoTripNames(t: Omit<Trip, 'group_name' | 'region_name'>): Trip {
  const g = demo.groups.find((x) => x.tour_area_code === t.tour_area_code)
  const r =
    t.tour_sigungu_code === null
      ? null
      : demo.regions.find(
          (x) =>
            x.tour_area_code === t.tour_area_code &&
            x.tour_sigungu_code === t.tour_sigungu_code,
        )
  return { ...(t as Trip), group_name: g?.name ?? '', region_name: r?.name ?? null }
}

export const trips = {
  async list(userId: string): Promise<Trip[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trips')
        .select(TRIP_SELECT)
        .eq('user_id', userId)
        .order('trip_date', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as TripRow[]).map(flattenTrip)
    }
    return readDb()
      .trips.filter((t) => t.user_id === userId)
      .sort((a, b) => b.trip_date.localeCompare(a.trip_date))
      .map(demoTripNames)
  },

  async get(id: string): Promise<Trip | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trips')
        .select(TRIP_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data ? flattenTrip(data as unknown as TripRow) : null
    }
    const t = readDb().trips.find((x) => x.id === id)
    return t ? demoTripNames(t) : null
  },

  async create(input: TripInput): Promise<Trip> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('trips').insert(input).select(TRIP_SELECT).single()
      if (error) throw error
      return flattenTrip(data as unknown as TripRow)
    }
    const row = {
      ...input,
      source_plan_id: input.source_plan_id ?? null,
      published_plan_id: null,
      id: uid('trip'),
      created_at: nowIso(),
    }
    mutateDb((d) => void d.trips.push(row))
    return demoTripNames(row)
  },

  async update(id: string, patch: Partial<TripInput>): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trips').update(patch).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trips.findIndex((t) => t.id === id)
      if (i >= 0) d.trips[i] = { ...d.trips[i], ...patch }
    })
  },

  async remove(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trips').delete().eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      d.trips = d.trips.filter((t) => t.id !== id)
      d.trip_items = d.trip_items.filter((it) => it.trip_id !== id)
    })
  },
}

/* ─────────────────── Trip items (TRIP-03-01) ─────────────────── */

export const tripItems = {
  async listByTrip(tripId: string): Promise<TripItem[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trip_items')
        .select('*, place:places(*)')
        .eq('trip_id', tripId)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as TripItem[]
    }
    // 장소 카탈로그가 교체되면 예전 place_id 를 가리키는 행이 localStorage 에
    // 남는다. 그대로 넘기면 place 가 undefined 인 항목이 화면에 흘러가므로,
    // 찾지 못한 것은 조용히 걸러낸다.
    return readDb()
      .trip_items.filter((it) => it.trip_id === tripId)
      .map((it) => ({ ...it, place: demo.places.find((p) => p.id === it.place_id) }))
      .filter((it) => it.place !== undefined)
      .sort((a, b) => a.sort_order - b.sort_order)
  },

  async add(input: {
    trip_id: string
    place_id: string
    planned_time?: string | null
  }): Promise<TripItem> {
    const sort_order = (await tripItems.listByTrip(input.trip_id)).length

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trip_items')
        .insert({
          trip_id: input.trip_id,
          place_id: input.place_id,
          sort_order,
          planned_time: input.planned_time ?? null,
          status: 'planned',
        })
        .select('*, place:places(*)')
        .single()
      if (error) throw error
      return data as TripItem
    }

    const row: TripItem = {
      id: uid('item'),
      trip_id: input.trip_id,
      place_id: input.place_id,
      sort_order,
      planned_time: input.planned_time ?? null,
      status: 'planned',
      note: null,
      rating: null,
    }
    mutateDb((d) => void d.trip_items.push(row))
    return { ...row, place: demo.places.find((p) => p.id === row.place_id) }
  },

  /** 드래그 앤 드롭 정렬 결과를 일괄 반영 */
  async reorder(items: Array<{ id: string; sort_order: number }>): Promise<void> {
    if (isSupabaseConfigured) {
      await Promise.all(
        items.map(({ id, sort_order }) =>
          sb().from('trip_items').update({ sort_order }).eq('id', id),
        ),
      )
      return
    }
    mutateDb((d) => {
      for (const patch of items) {
        const i = d.trip_items.findIndex((it) => it.id === patch.id)
        if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], sort_order: patch.sort_order }
      }
    })
  },

  async setStatus(id: string, status: TripItemStatus): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trip_items').update({ status }).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trip_items.findIndex((it) => it.id === id)
      if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], status }
    })
  },

  /** 방문 리뷰(소감+별점) 작성/수정 — 별도 이력 없이 값을 그대로 덮어쓴다. 빈 문자열은 null 로 저장한다 */
  async setReview(id: string, note: string, rating: number | null): Promise<void> {
    const noteValue = note.trim() || null
    if (isSupabaseConfigured) {
      const { error } = await sb()
        .from('trip_items')
        .update({ note: noteValue, rating })
        .eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trip_items.findIndex((it) => it.id === id)
      if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], note: noteValue, rating }
    })
  },

  async remove(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trip_items').delete().eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => void (d.trip_items = d.trip_items.filter((it) => it.id !== id)))
  },
}

/* ─────────────────── Shared plans (SHARE-06) ─────────────────── */

export interface PlanFilter {
  areaCode?: number
  sigunguCode?: number
  companions?: string[]
  transport?: string
  /** 인기순(담은 수)이 기본이다 — 장소 평점이 전부 null 이라 쓸 수 없다 */
  sort?: 'popular' | 'recent'
}

/**
 * 지역 이름을 함께 가져온다.
 *
 * 작성자는 조회하지 않는다. 화면에는 '운영자' 아니면 '회원' 만 뜨고,
 * 그 판정은 행 안의 `origin` 하나로 끝난다 (Q17).
 */
const PLAN_SELECT = '*, group:region_groups!inner(name), region:regions(name)'

type PlanRow = Omit<SharedPlan, 'group_name' | 'region_name'> & {
  group?: { name: string } | null
  region?: { name: string } | null
}

const flattenPlan = (row: PlanRow): SharedPlan => ({
  ...(row as unknown as SharedPlan),
  group_name: row.group?.name ?? '',
  region_name: row.region?.name ?? null,
})

/** 데모 모드에는 조인이 없으니 지역 이름을 직접 찾아 붙인다 */
function demoPlanNames(p: StoredPlan): SharedPlan {
  const g = demo.groups.find((x) => x.tour_area_code === p.tour_area_code)
  const r =
    p.tour_sigungu_code === null
      ? null
      : demo.regions.find(
          (x) =>
            x.tour_area_code === p.tour_area_code && x.tour_sigungu_code === p.tour_sigungu_code,
        )
  return {
    ...(p as SharedPlan),
    group_name: g?.name ?? '',
    region_name: r?.name ?? null,
  }
}

type StoredPlan = Omit<SharedPlan, 'group_name' | 'region_name' | 'items'>

/** 여행을 공용 플랜으로 올릴 때 사용자가 새로 입력하는 값 */
export interface PublishInput {
  title: string
  description: string
  /**
   * 올리는 사람이 관리자면 운영자 플랜이 된다 — 작성자를 비우고 origin 을
   * 'admin' 으로 적는다. 관리자 전용 작성 화면을 따로 두지 않기로 하면서
   * (Q20) 이 플래그가 두 종류를 가르는 유일한 자리가 됐다.
   */
  asAdmin?: boolean
  /** 장소별 한 줄 팁. trip_item.id → 팁. 비어 있으면 넣지 않는다 */
  tips?: Record<string, string>
}

const SEASON_OF_MONTH: Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
]

/** 특정 날짜는 위치 이력이 된다. 요일과 계절만 남긴다 */
function weekdayAndSeason(tripDate: string): { weekday: number; season: Season } {
  const d = new Date(`${tripDate}T00:00:00`)
  return { weekday: d.getDay(), season: SEASON_OF_MONTH[d.getMonth()] }
}

/**
 * 데모 저장소가 비어 있으면 예시 플랜을 한 번 심는다.
 *
 * 빈 리스트로 시작하면 데모에서 이 기능이 뭘 하는지 볼 수가 없다. 한 번
 * 심은 뒤에는 사용자가 담고 지운 결과가 그대로 남는다 — 매번 덮어쓰면
 * 데모에서 올린 플랜이 사라진다.
 */
function ensureDemoPlans(): void {
  if (isSupabaseConfigured) return
  const d = readDb()
  if (d.shared_plans.length > 0 || d.shared_plan_items.length > 0) return
  mutateDb((draft) => {
    draft.shared_plans.push(...demo.plans)
    draft.shared_plan_items.push(...demo.planItems)
  })
}

export const sharedPlans = {
  /**
   * 추천 코스 목록 — 한 쪽씩(offset 부터 limit 개). total 은 조건에 맞는 전체 개수.
   * 화면이 처음 10개, '코스 더 보기'마다 10개씩 더 받는다. 쪽을 나눠 받을 때 순서가 흔들리면
   * 쪽 사이에서 코스가 빠지거나 두 번 오므로 정렬 끝에 id 를 둔다.
   */
  async list(
    filter: PlanFilter = {},
    page: { offset: number; limit: number } = { offset: 0, limit: 10 },
  ): Promise<{ plans: SharedPlan[]; total: number }> {
    if (isSupabaseConfigured) {
      let query = sb()
        .from('shared_plans')
        .select(PLAN_SELECT, { count: 'exact' })
        .eq('is_hidden', false)
      if (filter.areaCode !== undefined) query = query.eq('tour_area_code', filter.areaCode)
      if (filter.sigunguCode !== undefined)
        query = query.eq('tour_sigungu_code', filter.sigunguCode)
      if (filter.transport) query = query.eq('transport', filter.transport)
      if (filter.companions?.length) query = query.overlaps('companions', filter.companions)
      const sorted =
        filter.sort === 'recent'
          ? query.order('created_at', { ascending: false })
          : query.order('clone_count', { ascending: false })
      const { data, error, count } = await sorted
        .order('id')
        .range(page.offset, page.offset + page.limit - 1)
      if (error) throw error
      const plans = ((data ?? []) as unknown as PlanRow[]).map(flattenPlan)
      return { plans, total: count ?? page.offset + plans.length }
    }

    ensureDemoPlans()
    const all = readDb()
      .shared_plans.filter((p) => {
        if (p.is_hidden) return false
        if (filter.areaCode !== undefined && p.tour_area_code !== filter.areaCode) return false
        if (filter.sigunguCode !== undefined && p.tour_sigungu_code !== filter.sigunguCode)
          return false
        if (filter.transport && p.transport !== filter.transport) return false
        if (filter.companions?.length && !p.companions.some((c) => filter.companions!.includes(c)))
          return false
        return true
      })
      .sort(
        (a, b) =>
          (filter.sort === 'recent'
            ? b.created_at.localeCompare(a.created_at)
            : b.clone_count - a.clone_count) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
    return {
      plans: all.slice(page.offset, page.offset + page.limit).map(demoPlanNames),
      total: all.length,
    }
  },

  /** 상세 — 항목과 장소까지 채워 준다 */
  async get(id: string): Promise<SharedPlan | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .select(PLAN_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) return null

      const { data: items, error: itemsError } = await sb()
        .from('shared_plan_items')
        .select('*, place:places(*)')
        .eq('plan_id', id)
        .order('sort_order')
      if (itemsError) throw itemsError

      const plan = flattenPlan(data as unknown as PlanRow)
      return { ...plan, items: (items ?? []) as SharedPlanItem[] }
    }

    ensureDemoPlans()
    const p = readDb().shared_plans.find((x) => x.id === id)
    if (!p) return null
    // 카탈로그가 교체되면 예전 place_id 를 가리키는 항목이 남는다. 장소를 찾지
    // 못한 항목은 조용히 걸러 낸다 — 화면에 빈 카드가 흘러가지 않게.
    const items = readDb()
      .shared_plan_items.filter((it) => it.plan_id === id)
      .map((it) => ({ ...it, place: demo.places.find((pl) => pl.id === it.place_id) }))
      .filter((it) => it.place !== undefined)
      .sort((a, b) => a.sort_order - b.sort_order)
    return { ...demoPlanNames(p), items }
  },

  /**
   * 관리자용 전체 목록. 내려간 플랜도 포함한다.
   *
   * RLS 가 `is_hidden = false or 작성자 or is_admin()` 이므로, 관리자가
   * 아닌 계정이 이걸 불러도 공개된 플랜만 돌아온다 — 화면 가드가 뚫려도
   * 데이터가 새지 않는다.
   */
  async listAll(): Promise<SharedPlan[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .select(PLAN_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as PlanRow[]).map(flattenPlan)
    }
    ensureDemoPlans()
    return readDb()
      .shared_plans.slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(demoPlanNames)
  },

  /** 내가 올린 플랜 (내려간 것도 보인다 — 왜 내려갔는지 알아야 하므로) */
  async listMine(userId: string): Promise<SharedPlan[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .select(PLAN_SELECT)
        .eq('author_user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as PlanRow[]).map(flattenPlan)
    }
    ensureDemoPlans()
    return readDb()
      .shared_plans.filter((p) => p.author_user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(demoPlanNames)
  },

  /**
   * 내 여행을 공용 플랜으로 올린다 — 스냅샷 복사다.
   *
   * `trip_date` 는 요일·계절로만 남기고, 항목의 `note`·`rating`·`status` 는
   * 넘기지 않는다. 공개하려는 건 동선이지 일기가 아니다.
   */
  async publishFromTrip(tripId: string, input: PublishInput): Promise<SharedPlan> {
    const trip = await trips.get(tripId)
    if (!trip) throw new Error('여행을 찾을 수 없습니다')
    const items = await tripItems.listByTrip(tripId)
    const { weekday, season } = weekdayAndSeason(trip.trip_date)
    // 운영자 플랜은 작성자가 없어야 한다 (DB 의 shared_plans_author_matches_origin)
    const row = {
      origin: input.asAdmin ? ('admin' as const) : ('user' as const),
      author_user_id: input.asAdmin ? null : trip.user_id,
      title: input.title,
      description: input.description,
      tour_area_code: trip.tour_area_code,
      tour_sigungu_code: trip.tour_sigungu_code,
      transport: trip.transport,
      companions: trip.companions,
      start_time: trip.start_time,
      end_time: trip.end_time,
      weekday,
      season,
      place_count: items.length,
      // 원본을 나중에 다시 조회해 알아낼 수는 없다 — 올리는 이 시점에 계산한다
      was_visited: items.some((it) => it.status === 'visited'),
    }

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .insert(row)
        .select(PLAN_SELECT)
        .single()
      if (error) throw error
      const plan = flattenPlan(data as unknown as PlanRow)
      const { error: itemsError } = await sb().from('shared_plan_items').insert(
        items.map((it) => ({
          plan_id: plan.id,
          place_id: it.place_id,
          sort_order: it.sort_order,
          planned_time: it.planned_time,
          tip: input.tips?.[it.id]?.trim() || null,
        })),
      )
      if (itemsError) throw itemsError

      // 비공개 여행 쪽에 "이 여행이 이 코스가 됐다"를 남긴다 (Q23).
      // 실패해도 던지지 않는다. 공유 자체는 이미 끝났고, 여기서 던지면 화면이
      // 실패로 보여 사용자가 다시 누르고, 같은 코스가 하나 더 생긴다. 연결을
      // 못 남기면 타임라인에 공유 버튼이 다시 보이는 정도로 끝난다.
      const { error: linkError } = await sb()
        .from('trips')
        .update({ published_plan_id: plan.id })
        .eq('id', tripId)
      if (linkError) console.warn('공유한 코스를 여행에 연결하지 못했습니다', linkError)
      return plan
    }

    const stored: StoredPlan = {
      ...row,
      id: uid('plan'),
      duration_minutes: null,
      clone_count: 0,
      rating_avg: null,
      rating_count: 0,
      is_hidden: false,
      hidden_reason: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    mutateDb((d) => {
      d.shared_plans.push(stored)
      for (const it of items) {
        d.shared_plan_items.push({
          id: uid('planitem'),
          plan_id: stored.id,
          place_id: it.place_id,
          sort_order: it.sort_order,
          planned_time: it.planned_time,
          tip: input.tips?.[it.id]?.trim() || null,
        })
      }
      const t = d.trips.find((x) => x.id === tripId)
      if (t) t.published_plan_id = stored.id
    })
    return demoPlanNames(stored)
  },

  /** 운영자가 원본 여행 없이 만든다 — 담긴 장소를 직접 엮는다 */

  /**
   * 담기 — 복제이지 참조가 아니다. 원본 플랜이 내려가도 내 여행은 그대로다.
   *
   * RLS 아래에서 사용자는 남의 행을 update 할 수 없으므로 clone_count 증가를
   * 클라이언트가 할 수 없다. 담기와 카운트를 서버 함수 하나로 묶었다.
   */
  async clone(
    planId: string,
    tripDate: string,
    /** 데모 모드에서만 쓴다. Supabase 모드는 서버가 auth.uid() 로 정한다 */
    opts: { userId: string; title?: string },
  ): Promise<string> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().rpc('clone_shared_plan', {
        p_plan_id: planId,
        p_trip_date: tripDate,
        p_title: opts.title ?? null,
      })
      if (error) throw error
      return data as string
    }

    const plan = await sharedPlans.get(planId)
    if (!plan || plan.is_hidden) throw new Error('코스를 찾을 수 없습니다')

    const trip = await trips.create({
      user_id: opts.userId,
      source_plan_id: plan.id,
      title: opts.title ?? plan.title,
      tour_area_code: plan.tour_area_code,
      tour_sigungu_code: plan.tour_sigungu_code,
      trip_date: tripDate,
      start_time: plan.start_time,
      end_time: plan.end_time,
      companions: plan.companions,
      transport: plan.transport,
    })

    mutateDb((d) => {
      for (const it of plan.items ?? []) {
        // status 는 planned 로, note·rating 은 비운 채로 들어간다.
        // 여행의 시작 시각을 플랜과 같게 잡았으므로 planned_time 은 그대로 옮긴다.
        d.trip_items.push({
          id: uid('item'),
          trip_id: trip.id,
          place_id: it.place_id,
          sort_order: it.sort_order,
          planned_time: it.planned_time,
          status: 'planned',
          note: null,
          rating: null,
        })
      }
      const i = d.shared_plans.findIndex((p) => p.id === planId)
      if (i >= 0) d.shared_plans[i] = { ...d.shared_plans[i], clone_count: d.shared_plans[i].clone_count + 1 }
    })
    return trip.id
  },

  /**
   * 작성자·관리자만 내린다. 이미 담아 간 사람의 여행은 복사본이라 그대로 남는다.
   *
   * reason 은 "누가 내렸는가"를 적는 칸이다. 작성자가 스스로 내리면 null 이고,
   * 운영자가 내리면 'admin' 이다. 이 구분이 있어야 작성자 화면에서 "다시 공개"
   * 버튼을 내보낼지 판단할 수 있다 — 운영자가 내린 것을 작성자가 바로 되살리면
   * 운영자 조치가 의미를 잃는다.
   */
  async setHidden(
    id: string,
    hidden: boolean,
    reason: PlanHiddenReason | null = null,
  ): Promise<void> {
    const hiddenReason = hidden ? reason : null
    if (isSupabaseConfigured) {
      const { error } = await sb()
        .from('shared_plans')
        .update({ is_hidden: hidden, hidden_reason: hiddenReason })
        .eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.shared_plans.findIndex((p) => p.id === id)
      if (i >= 0)
        d.shared_plans[i] = {
          ...d.shared_plans[i],
          is_hidden: hidden,
          hidden_reason: hiddenReason,
        }
    })
  },

  async remove(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('shared_plans').delete().eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      d.shared_plans = d.shared_plans.filter((p) => p.id !== id)
      d.shared_plan_items = d.shared_plan_items.filter((it) => it.plan_id !== id)
      // DB 의 `on delete set null` 을 흉내 낸다. 담아 온 여행(source_plan_id)도
      // 같은 처리가 빠져 있어 지워진 코스를 가리키는 링크가 남았다 — 함께 고친다.
      for (const t of d.trips) {
        if (t.source_plan_id === id) t.source_plan_id = null
        if (t.published_plan_id === id) t.published_plan_id = null
      }
    })
  },

}

/* ─────────────────── 장소 직접 등록 (PLACE-07-01) ─────────────────── */

/** 관리자가 직접 등록할 때 넘기는 값 */
export interface AdminPlaceInput {
  name: string
  category: PlaceCategory
  address: string
  lat: number
  lng: number
  image_url: string | null
  tour_area_code: number
  tour_sigungu_code: number
}

export const adminPlaces = {
  /**
   * 관리자 직접 등록 — 승인 단계 없이 바로 `places` 에 들어간다 (4-3).
   *
   * id 는 클라이언트가 만들지 않는다. 'm-000001' 규약과 시퀀스의 주인이
   * 둘이 되면 번호가 어긋나므로, 서버 함수 안에서만 시퀀스를 돌린다.
   */
  async create(input: AdminPlaceInput): Promise<string> {
    if (!isSupabaseConfigured) {
      throw new Error('데모 모드에서는 장소를 등록할 수 없습니다')
    }
    const { data, error } = await sb().rpc('admin_create_place', {
      p_name: input.name,
      p_category: input.category,
      p_address: input.address,
      p_lat: input.lat,
      p_lng: input.lng,
      p_tour_area_code: input.tour_area_code,
      p_tour_sigungu_code: input.tour_sigungu_code,
      p_image_url: input.image_url,
    })
    if (error) throw error
    return data as string
  },

  /** 수동 등록 장소만 모아 본다. 연동 행은 배치가 관리하므로 섞지 않는다 */
  async listManual(): Promise<Place[]> {
    if (!isSupabaseConfigured) return []
    const { data, error } = await sb()
      .from('places')
      .select(PLACE_SELECT)
      .eq('source', 'manual')
      .order('id', { ascending: false })
    if (error) throw error
    return ((data ?? []) as unknown as PlaceRow[]).map(flattenPlace)
  },
}

/* ─────────────────── Plan ratings (SHARE-06-07) ─────────────────── */

/**
 * 플랜 만족도.
 *
 * 담은 수는 "고르게 만드는 힘"은 재지만 "실제로 좋았는지"는 재지 못한다.
 * 표지와 제목이 그럴듯하면 담기까지는 간다. 그래서 두 번째 신호가 필요하다.
 *
 * 자격 판정(담은 적 있는 사람만, 자기 플랜은 불가)은 전부 DB 의 RLS 가
 * 한다. 화면은 버튼을 가릴 뿐이고, 가려진 버튼을 뚫어도 서버가 거부한다.
 */
export const planRatings = {
  async listByPlan(planId: string): Promise<PlanRating[]> {
    if (!isSupabaseConfigured) return []
    const { data, error } = await sb()
      .from('plan_ratings')
      .select('*')
      .eq('plan_id', planId)
      .order('updated_at', { ascending: false })
    if (error) throw error

    return (data ?? []) as PlanRating[]
  },

  /** 내가 이 플랜에 남긴 평가 (없으면 null) */
  async mine(planId: string, userId: string): Promise<PlanRating | null> {
    if (!isSupabaseConfigured) return null
    const { data, error } = await sb()
      .from('plan_ratings')
      .select('*')
      .eq('plan_id', planId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return (data as PlanRating) ?? null
  },

  /**
   * 이 사람이 이 플랜을 담은 적이 있는가 — 평가 버튼을 보일지 판단한다.
   *
   * 자기 여행만 보이는 RLS 아래에서 세므로, 남이 담았는지는 알 수 없고
   * 알 필요도 없다.
   */
  async canRate(planId: string, userId: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false
    const { count, error } = await sb()
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('source_plan_id', planId)
      .eq('user_id', userId)
    if (error) throw error
    return (count ?? 0) > 0
  },

  /** 한 사람이 한 플랜에 하나. 다시 남기면 덮어쓴다 */
  async save(planId: string, userId: string, rating: number, comment: string): Promise<void> {
    if (!isSupabaseConfigured) {
      throw new Error('데모 모드에서는 만족도를 남길 수 없습니다')
    }
    const { error } = await sb()
      .from('plan_ratings')
      .upsert(
        {
          plan_id: planId,
          user_id: userId,
          rating,
          comment: comment.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'plan_id,user_id' },
      )
    if (error) throw error
  },

  async remove(planId: string, userId: string): Promise<void> {
    if (!isSupabaseConfigured) return
    const { error } = await sb()
      .from('plan_ratings')
      .delete()
      .eq('plan_id', planId)
      .eq('user_id', userId)
    if (error) throw error
  },
}
