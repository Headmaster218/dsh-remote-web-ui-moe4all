import { useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { readLanBindStatus, type LanBindFrame } from './pair-api.ts'
import type { RemoteSettings } from './RemoteSettingsCard.tsx'

const DONE_KEY = 'moe4all.phone-guide.v1'

export function PhoneGuide({ scope, t }: {
  scope: SettingsScope<RemoteSettings>
  t: TranslateNS<'remote'>
}) {
  const [frame, setFrame] = useState<LanBindFrame | null>(null)
  const [address, setAddress] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [working, setWorking] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(() => {
    try { return localStorage.getItem(DONE_KEY) === '1' } catch { return true }
  })

  useEffect(() => {
    if (done || !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)) return
    let alive = true
    const poll = async (): Promise<void> => {
      if (document.documentElement.dataset.moe4allSettings === 'open') return
      try {
        const response = await fetch('/api/moe4all/status', { cache: 'no-store' })
        if (!response.ok) return
        const engine = await response.json() as { ready?: boolean }
        if (engine.ready !== true) return
        const next = await readLanBindStatus()
        if (alive) {
          setFrame(next)
          setAddress(previous => previous || next.preferredLanAddress || next.interfaces?.[0]?.address || '')
        }
      } catch { /* Keep waiting while the Engine or pairing service starts. */ }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 5_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [done])

  if (done || frame === null) return null

  const finish = (): void => {
    try { localStorage.setItem(DONE_KEY, '1') } catch { /* The current session still closes. */ }
    setDone(true)
  }
  const enable = async (): Promise<void> => {
    if (!acknowledged || !address || working) return
    setWorking(true)
    setError('')
    try {
      await scope.set('preferredLanAddress', address)
      await scope.set('lanBind', true)
      setEnabled(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,.65)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="moe4all-phone-guide-title" style={{ width: 'min(100%, 440px)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', border: '1px solid #555', borderRadius: 8, background: '#292929', color: '#f3f3f3', padding: 24, boxSizing: 'border-box', lineHeight: 1.5 }}>
        <h2 id="moe4all-phone-guide-title" style={{ margin: '0 0 8px', fontSize: 20 }}>{t('phone.title')}</h2>
        {enabled ? (
          <>
            <p>{t('phone.restart')}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={finish} style={{ padding: '8px 12px' }}>{t('phone.done')}</button>
            </div>
          </>
        ) : (
          <>
        <p style={{ margin: '0 0 20px', color: '#c4c4c4' }}>{t('phone.intro')}</p>
        <label htmlFor="moe4all-phone-adapter" style={{ display: 'block', marginBottom: 6 }}>{t('phone.adapter')}</label>
        <select id="moe4all-phone-adapter" value={address} onChange={event => setAddress(event.target.value)} style={{ width: '100%', minHeight: 38, marginBottom: 16, color: '#f3f3f3', background: '#383838', border: '1px solid #686868', borderRadius: 4 }}>
          {(frame.interfaces ?? []).map(iface => <option key={`${iface.name}/${iface.address}`} value={iface.address}>{iface.name} - {iface.address}</option>)}
        </select>
        <p style={{ margin: '0 0 16px', color: '#e5c088' }}>{t('phone.warning')}</p>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 20 }}>
          <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} style={{ marginTop: 5 }} />
          <span>{t('phone.confirmRisk')}</span>
        </label>
        {error && <p role="alert" style={{ color: '#f6a8a8' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={finish} style={{ padding: '8px 12px' }}>{t('phone.skip')}</button>
          <button type="button" disabled={!acknowledged || !address || working} onClick={() => { void enable() }} style={{ padding: '8px 12px' }}>{t('phone.enable')}</button>
        </div>
          </>
        )}
      </section>
    </div>
  )
}
