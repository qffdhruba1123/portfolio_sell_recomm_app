import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_PROXY, emptyState } from '../types'
import { loadState, saveState } from './storage'

describe('loadState — corsProxyPrefix upgrade', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('upgrades an unmodified legacy default proxy to the auto chain', () => {
    const legacy = { ...emptyState(), settings: { ...emptyState().settings, corsProxyPrefix: 'https://corsproxy.io/?url=' } }
    saveState(legacy)
    expect(loadState().settings.corsProxyPrefix).toBe(AUTO_PROXY)
  })

  it('leaves a genuinely customized proxy untouched', () => {
    const customized = { ...emptyState(), settings: { ...emptyState().settings, corsProxyPrefix: 'https://my-own-proxy.example/?url=' } }
    saveState(customized)
    expect(loadState().settings.corsProxyPrefix).toBe('https://my-own-proxy.example/?url=')
  })

  it('leaves an already-auto setting untouched', () => {
    const state = { ...emptyState(), settings: { ...emptyState().settings, corsProxyPrefix: AUTO_PROXY } }
    saveState(state)
    expect(loadState().settings.corsProxyPrefix).toBe(AUTO_PROXY)
  })
})
