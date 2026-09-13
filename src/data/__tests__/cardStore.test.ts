import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The riftcodex pool is 15 pages and the API answers each in 10-35s, so how
 * this module fetches is the difference between a 40s load and a 3-minute one
 * that gets reported as "stuck on loading".
 */

interface StoredShape {
  cards: unknown[]
  timestamp: number
}

/** Minimal localStorage — the module only ever gets/sets one key. */
function fakeStorage(seed?: StoredShape) {
  const map = new Map<string, string>()
  if (seed) map.set('riftbound_cards_v2', JSON.stringify(seed))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
}

function rawCard(id: string) {
  return {
    id,
    riftbound_id: id,
    name: `Card ${id}`,
    classification: { type: 'Unit', domain: ['fury'], rarity: 'common' },
    attributes: { energy: 1, might: 1, power: 0 },
    text: { plain: '' },
  }
}

/** A stand-in API: `pages` pages of one card each, recording concurrency. */
function fakeApi(pages: number) {
  const state = { calls: [] as number[], live: 0, peak: 0, delay: 5 }
  const fetchMock = vi.fn(async (url: string) => {
    const page = Number(new URL(url).searchParams.get('page'))
    state.calls.push(page)
    state.live++
    state.peak = Math.max(state.peak, state.live)
    await new Promise((r) => setTimeout(r, state.delay))
    state.live--
    return {
      ok: true,
      json: async () => ({ items: [rawCard(`p${page}`)], total: pages, page, size: 100, pages }),
    } as unknown as Response
  })
  return { state, fetchMock }
}

/**
 * Collapse the retry backoff. Three real waits per failing page is 1.8s of
 * dead time in a suite that otherwise runs in seconds.
 */
function noBackoff() {
  const real = globalThis.setTimeout
  vi.stubGlobal('setTimeout', ((fn: () => void, ms?: number) =>
    ms && ms >= 500 ? (fn(), 0) : real(fn, ms)) as typeof setTimeout)
}

/** Fresh module instance — the pool is cached in module scope. */
async function freshStore() {
  vi.resetModules()
  return import('../cardStore')
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchAllCards', () => {
  it('fetches the remaining pages concurrently, not one at a time', async () => {
    const { state, fetchMock } = fakeApi(15)
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAllCards } = await freshStore()

    const cards = await fetchAllCards()

    expect(cards).toHaveLength(15)
    expect(fetchMock).toHaveBeenCalledTimes(15)
    // Page 1 is serial (it reports the page count); the other 14 overlap.
    expect(state.peak).toBeGreaterThan(1)
  })

  it('keeps pages in order regardless of which request finishes first', async () => {
    const { fetchMock } = fakeApi(6)
    // Make later pages return sooner so completion order != page order.
    const staggered = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      await new Promise((r) => setTimeout(r, (10 - page) * 4))
      return fetchMock(url)
    })
    vi.stubGlobal('fetch', staggered)
    const { fetchAllCards } = await freshStore()

    const cards = await fetchAllCards()
    expect(cards.map((c) => c.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
  })

  it('reports progress so the loading screen can show a count', async () => {
    const { fetchMock } = fakeApi(5)
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAllCards } = await freshStore()

    const seen: Array<[number, number]> = []
    await fetchAllCards((p) => seen.push([p.done, p.total]))

    expect(seen[0]).toEqual([1, 5])
    expect(seen).toHaveLength(5)
    expect(seen[seen.length - 1]).toEqual([5, 5])
    // Monotonic — a bar that jumps backwards looks broken.
    expect(seen.map(([d]) => d)).toEqual([...seen.map(([d]) => d)].sort((a, b) => a - b))
  })

  it('collapses overlapping loads into one network pass', async () => {
    // StrictMode runs App's effect twice in dev; without this the cold load
    // fired 30 requests at an API that is already the bottleneck.
    const { fetchMock } = fakeApi(4)
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAllCards } = await freshStore()

    const [a, b] = await Promise.all([fetchAllCards(), fetchAllCards()])

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(a).toBe(b)
  })

  it('retries a failed page before giving up', async () => {
    noBackoff()
    let failures = 2
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'))
      if (page === 2 && failures-- > 0) throw new Error('network')
      return {
        ok: true,
        json: async () => ({ items: [rawCard(`p${page}`)], total: 3, page, size: 100, pages: 3 }),
      } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAllCards } = await freshStore()

    const cards = await fetchAllCards()
    expect(cards.map((c) => c.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('falls back to an expired cache rather than failing the load', async () => {
    noBackoff()
    const stale = {
      cards: [{ id: 'old', name: 'Old Card', cleanName: 'Old Card', type: 'unit' }],
      timestamp: Date.now() - 1000 * 60 * 60 * 48, // two days old
    }
    vi.stubGlobal('localStorage', fakeStorage(stale))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const { fetchAllCards } = await freshStore()

    // A day-old pool still plays; only the newest printings would be missing.
    const cards = await fetchAllCards()
    expect(cards.map((c) => c.id)).toEqual(['old'])
  })

  it('still throws when the network fails and there is no cache at all', async () => {
    noBackoff()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    const { fetchAllCards } = await freshStore()
    await expect(fetchAllCards()).rejects.toThrow('offline')
  })

  it('serves a fresh cache without touching the network', async () => {
    const fresh = {
      cards: [{ id: 'cached', name: 'Cached', cleanName: 'Cached', type: 'unit' }],
      timestamp: Date.now(),
    }
    vi.stubGlobal('localStorage', fakeStorage(fresh))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAllCards } = await freshStore()

    const cards = await fetchAllCards()
    expect(cards.map((c) => c.id)).toEqual(['cached'])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
