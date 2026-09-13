import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DICTIONARIES, en, type Locale, type StringKey } from './strings'

export type { Locale, StringKey }
export { LOCALES } from './strings'

const STORAGE_KEY = 'rb-locale'

/** `{name}` placeholders are substituted from `params`; unknown ones are left alone. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  )
}

export type TFn = (key: StringKey, params?: Record<string, string | number>) => string

type LocaleCtx = { locale: Locale; setLocale: (l: Locale) => void; t: TFn }

const Ctx = createContext<LocaleCtx | null>(null)

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ko') return saved
  } catch {
    /* private mode / storage disabled */
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('ko') ? 'ko' : 'en'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])

  // Drives the `[lang="ko"]` CSS rules (font stack, no uppercasing of HUD labels).
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const t = useCallback<TFn>(
    (key, params) => interpolate(DICTIONARIES[locale][key] ?? en[key] ?? key, params),
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useLocale must be used inside <LocaleProvider>')
  return ctx
}

/** Convenience: just the translate function. */
export function useT(): TFn {
  return useLocale().t
}
