/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_NAVER_MAP_CLIENT_ID?: string
  /** 'ncpKeyId'(신규 콘솔, 기본값) 또는 'ncpClientId'(구 콘솔) */
  readonly VITE_NAVER_MAP_AUTH_PARAM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
