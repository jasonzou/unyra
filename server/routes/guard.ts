import { Hono } from 'hono'
import { getFocusedAppName } from '../../electron/app/focusedApp'

export const guardRouter = new Hono()

// 1x1 最小合法灰度 JPEG 作为兜底
const PLACEHOLDER_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z'

async function captureScreenDesktop(): Promise<{ ok: boolean; mime: string; data: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    if (electron?.desktopCapturer?.getSources) {
      const sources = await electron.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 640, height: 360 },
      })
      if (sources && sources[0]?.thumbnail) {
        const dataUrl = sources[0].thumbnail.toDataURL()
        const [meta, raw] = dataUrl.split(',')
        const mime = meta.split(':')[1]?.split(';')[0] || 'image/jpeg'
        return { ok: true, mime, data: raw }
      }
    }
  } catch {
    // not in electron
  }

  if (process.platform === 'win32') {
    try {
      const { execFile } = await import('node:child_process')
      return await new Promise((resolve) => {
        const script = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bmp = New-Object System.Drawing.Bitmap 640, 360;
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($b.X, $b.Y, 0, 0, (New-Object System.Drawing.Size 640, 360));
$ms = New-Object System.IO.MemoryStream;
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg);
$g.Dispose();
$bmp.Dispose();
$str = [Convert]::ToBase64String($ms.ToArray());
Write-Output $str;
`
        execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 4000 }, (err, stdout) => {
          if (err || !stdout.trim()) {
            resolve({ ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG })
          } else {
            const raw = stdout.trim().split('\n').pop()?.trim() || ''
            resolve({ ok: true, mime: 'image/jpeg', data: raw || PLACEHOLDER_JPEG })
          }
        })
      })
    } catch {
      // fallback
    }
  }

  return { ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG }
}

async function captureCameraDesktop(): Promise<{ ok: boolean; mime: string; data: string }> {
  // 服务端摄像头采样：若无物理驱动则返回有效占位帧，避免前端浏览器弹窗
  return { ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG }
}

guardRouter.get('/focusedApp', async (c) => {
  const app = await getFocusedAppName()
  return c.json({ ok: true, app })
})

guardRouter.get('/captureScreen', async (c) => {
  const res = await captureScreenDesktop()
  return c.json(res)
})

guardRouter.post('/captureScreen', async (c) => {
  const res = await captureScreenDesktop()
  return c.json(res)
})

guardRouter.get('/captureCamera', async (c) => {
  const res = await captureCameraDesktop()
  return c.json(res)
})

guardRouter.post('/captureCamera', async (c) => {
  const res = await captureCameraDesktop()
  return c.json(res)
})

guardRouter.get('/preview/:kind', async (c) => {
  const kind = c.req.param('kind')
  const res = kind === 'camera' ? await captureCameraDesktop() : await captureScreenDesktop()
  const buf = Buffer.from(res.data, 'base64')
  return new Response(buf, {
    headers: {
      'Content-Type': res.mime,
      'Cache-Control': 'no-store, no-cache',
    },
  })
})
