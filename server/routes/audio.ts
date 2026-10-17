import { Hono } from 'hono'

export const audioRouter = new Hono()

function generateSpectrum(bins = 64): number[] {
  const t = Date.now() / 1000
  const data: number[] = new Array(bins)
  for (let i = 0; i < bins; i++) {
    const freqFactor = (i / bins) * Math.PI * 3.5
    const v1 = Math.sin(t * 2.8 + freqFactor)
    const v2 = Math.cos(t * 1.6 - freqFactor * 0.6)
    const v3 = Math.sin(t * 4.5 + i * 0.25)
    const raw = (v1 * 0.45 + v2 * 0.35 + v3 * 0.2 + 1) / 2
    // 衰减高频，保留温和生动的律动感
    const falloff = Math.exp(-i / (bins * 0.65))
    data[i] = Math.max(12, Math.min(255, Math.floor(raw * 230 * (0.3 + 0.7 * falloff))))
  }
  return data
}

audioRouter.get('/spectrum', (c) => {
  const bins = Math.min(256, Math.max(16, Number(c.req.query('bins')) || 64))
  return c.json({
    ok: true,
    bins,
    sampleRate: 44100,
    data: generateSpectrum(bins),
  })
})

audioRouter.get('/status', (c) => {
  return c.json({
    ok: true,
    mode: 'server-loopback',
  })
})
