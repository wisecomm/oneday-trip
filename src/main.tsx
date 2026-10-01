import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { isSupabaseConfigured } from './lib/supabase'
import { loadDemoData } from './lib/demo-data'
import './index.css'

/**
 * 데모 모드일 때만 데모 카탈로그를 받아 온다.
 *
 * `db.ts` 의 데모 분기는 전부 동기 코드라 화면을 그리기 **전에** 채워져 있어야
 * 한다. 운영 모드에서는 이 import 가 실행되지 않아 번들에서 빠진다
 * (`lib/demo-data.ts` 참조).
 */
async function boot() {
  if (!isSupabaseConfigured) await loadDemoData()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

void boot()
