import { Suspense, lazy, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { AppLayout } from '@/components/AppLayout'
import { Loading } from '@/components/ui'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'

/**
 * 화면을 화면 단위로 나눠 받는다.
 *
 * 전부 정적으로 import 하면 첫 화면을 열자마자 관리자 화면까지 포함한 모든
 * 화면을 내려받는다. 대부분은 그 사용자가 평생 열지 않는다.
 *
 * 홈과 로그인만 함께 묶는다 — 들어오는 길이 사실상 그 둘뿐이라, 늦게 받으면
 * 첫 화면에 로딩이 한 번 더 깜빡인다. 나머지는 누를 때 받는다.
 *
 * 각 화면이 이름 있는 export 라 default 로 바꿔 주는 껍데기가 필요하다.
 */
function lazyPage<M extends Record<string, unknown>, K extends keyof M>(
  load: () => Promise<M>,
  key: K,
) {
  return lazy(async () => ({ default: (await load())[key] as ComponentType }))
}

const SignupPage = lazyPage(() => import('@/pages/SignupPage'), 'SignupPage')
const ProfileSetupPage = lazyPage(() => import('@/pages/ProfileSetupPage'), 'ProfileSetupPage')
const AccountHelpPage = lazyPage(() => import('@/pages/AccountHelpPage'), 'AccountHelpPage')
const AuthCallbackPage = lazyPage(() => import('@/pages/AuthCallbackPage'), 'AuthCallbackPage')
const TripCreatePage = lazyPage(() => import('@/pages/TripCreatePage'), 'TripCreatePage')
const TripRulesPage = lazyPage(() => import('@/pages/TripRulesPage'), 'TripRulesPage')
const TripListPage = lazyPage(() => import('@/pages/TripListPage'), 'TripListPage')
const TimelinePage = lazyPage(() => import('@/pages/TimelinePage'), 'TimelinePage')
const RoutePage = lazyPage(() => import('@/pages/RoutePage'), 'RoutePage')
const ExplorePage = lazyPage(() => import('@/pages/ExplorePage'), 'ExplorePage')
const RecommendPage = lazyPage(() => import('@/pages/RecommendPage'), 'RecommendPage')
const PlaceDetailPage = lazyPage(() => import('@/pages/PlaceDetailPage'), 'PlaceDetailPage')
const MyPage = lazyPage(() => import('@/pages/MyPage'), 'MyPage')
const PlanListPage = lazyPage(() => import('@/pages/PlanListPage'), 'PlanListPage')
const PlanDetailPage = lazyPage(() => import('@/pages/PlanDetailPage'), 'PlanDetailPage')
const PlanPublishPage = lazyPage(() => import('@/pages/PlanPublishPage'), 'PlanPublishPage')
const MyPlansPage = lazyPage(() => import('@/pages/MyPlansPage'), 'MyPlansPage')
const AdminPlansPage = lazyPage(() => import('@/pages/AdminPlansPage'), 'AdminPlansPage')
const AdminPlacesPage = lazyPage(() => import('@/pages/AdminPlacesPage'), 'AdminPlacesPage')

/**
 * 관리자 화면 가드.
 *
 * 화면을 가리는 것뿐이고 실제 방어선은 RLS 다 — 이 가드가 뚫려도 서버가
 * 거부한다. 판정은 profiles.role 이고, 임명은 화면이 아니라 SQL 로만 한다
 * (intent 7-D6).
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (profile?.role !== 'admin') return <Navigate to="/me" replace />
  return <>{children}</>
}

/** 로그인이 필요한 화면 가드 (IA '작업 조건: 필수') */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      {/* 화면 청크를 받아 오는 동안 보여 줄 것. 화면 안의 데이터 로딩과 같은
          스피너라 사용자에게는 한 가지 기다림으로 보인다 */}
      <Suspense fallback={<Loading />}>
        <Routes>
        {/* 인증 · 온보딩 (풀스크린) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/help/account" element={<AccountHelpPage />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <ProfileSetupPage />
            </RequireAuth>
          }
        />

        {/* 하단 내비게이션 셸 */}
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />

          {/* 비로그인 열람 가능 (Guest 모드) */}
          <Route path="map" element={<ExplorePage />} />
          <Route path="places/:placeId" element={<PlaceDetailPage />} />
          {/* 공유 링크를 받은 사람이 로그인 벽을 먼저 만나면 공유가 성립하지 않는다.
              담기를 누를 때 로그인으로 보낸다 (SHARE-06-01 / 06-02) */}
          <Route path="plans" element={<PlanListPage />} />
          <Route path="plans/:planId" element={<PlanDetailPage />} />

          <Route
            path="recommend"
            element={
              <RequireAuth>
                <RecommendPage />
              </RequireAuth>
            }
          />
          <Route
            path="trips"
            element={
              <RequireAuth>
                <TripListPage />
              </RequireAuth>
            }
          />
          <Route
            path="trips/new"
            element={
              <RequireAuth>
                <TripCreatePage />
              </RequireAuth>
            }
          />
          <Route
            path="trips/:tripId"
            element={
              <RequireAuth>
                <TimelinePage />
              </RequireAuth>
            }
          />
          {/* 생성 마법사 2단계 — 저장은 이 화면에서 한 번에 일어난다 */}
          <Route
            path="trips/new/rules"
            element={
              <RequireAuth>
                <TripRulesPage />
              </RequireAuth>
            }
          />
          <Route
            path="trips/:tripId/rules"
            element={
              <RequireAuth>
                <TripRulesPage />
              </RequireAuth>
            }
          />
          <Route
            path="trips/:tripId/route"
            element={
              <RequireAuth>
                <RoutePage />
              </RequireAuth>
            }
          />
          <Route
            path="trips/:tripId/share"
            element={
              <RequireAuth>
                <PlanPublishPage />
              </RequireAuth>
            }
          />
          {/* MY 는 비로그인 상태에서 로그인 유도 화면을 직접 노출하므로 가드하지 않는다 */}
          <Route path="me" element={<MyPage />} />
          <Route
            path="me/plans"
            element={
              <RequireAuth>
                <MyPlansPage />
              </RequireAuth>
            }
          />
          <Route
            path="admin/plans"
            element={
              <RequireAdmin>
                <AdminPlansPage />
              </RequireAdmin>
            }
          />
          <Route
            path="admin/places"
            element={
              <RequireAdmin>
                <AdminPlacesPage />
              </RequireAdmin>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
