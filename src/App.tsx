import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { AppLayout } from '@/components/AppLayout'
import { Loading } from '@/components/ui'
import { LoginPage } from '@/pages/LoginPage'
import { SignupPage } from '@/pages/SignupPage'
import { ProfileSetupPage } from '@/pages/ProfileSetupPage'
import { AccountHelpPage } from '@/pages/AccountHelpPage'
import { AuthCallbackPage } from '@/pages/AuthCallbackPage'
import { HomePage } from '@/pages/HomePage'
import { TripCreatePage } from '@/pages/TripCreatePage'
import { TripRulesPage } from '@/pages/TripRulesPage'
import { TripListPage } from '@/pages/TripListPage'
import { TimelinePage } from '@/pages/TimelinePage'
import { RoutePage } from '@/pages/RoutePage'
import { ExplorePage } from '@/pages/ExplorePage'
import { RecommendPage } from '@/pages/RecommendPage'
import { PlaceDetailPage } from '@/pages/PlaceDetailPage'
import { MyPage } from '@/pages/MyPage'

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
          {/* MY 는 비로그인 상태에서 로그인 유도 화면을 직접 노출하므로 가드하지 않는다 */}
          <Route path="me" element={<MyPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
