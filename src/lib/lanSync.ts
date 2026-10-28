import { useEffect, useState, useCallback } from 'react'
import { native } from './native'
import type {
  LanDeviceInfo,
  LanRequestFileOptions,
  LanRequestFileResult,
  LanServerStatus,
  LanUploadedFile,
} from '../../shared/lan'

export type {
  LanDeviceInfo,
  LanRequestFileOptions,
  LanRequestFileResult,
  LanServerStatus,
  LanUploadedFile,
}

/**
 * 软件内部核心 API：向连接的局域网移动设备发布获取文件的意图。
 * 手机端收到意图提示并完成文件上传后，该 Promise 返回上传的文件信息。
 *
 * @example
 * ```ts
 * const res = await requestDeviceFile({ prompt: '请拍照上传笔记草稿', accept: 'image/*' })
 * if (res.ok && res.file) {
 *   console.log('收到手机上传的文件:', res.file.path)
 * }
 * ```
 */
export async function requestDeviceFile(
  options: LanRequestFileOptions = {},
): Promise<LanRequestFileResult> {
  const bridge = native().lan
  if (!bridge) {
    return { ok: false, error: '当前环境不支持局域网服务' }
  }
  return await bridge.requestDeviceFile(options)
}

export async function startLanServer(port?: number): Promise<LanServerStatus | null> {
  const bridge = native().lan
  if (!bridge) return null
  return await bridge.startServer(port)
}

export async function stopLanServer(): Promise<boolean> {
  const bridge = native().lan
  if (!bridge) return false
  return await bridge.stopServer()
}

export async function getLanStatus(): Promise<LanServerStatus | null> {
  const bridge = native().lan
  if (!bridge) return null
  return await bridge.getStatus()
}

export async function setSelectedLanIp(ip: string): Promise<LanServerStatus | null> {
  const bridge = native().lan
  if (!bridge) return null
  return await bridge.setSelectedIp(ip)
}

export async function getLanQrDataUrl(ip?: string): Promise<string> {
  const bridge = native().lan
  if (!bridge) return ''
  return await bridge.getQrDataUrl(ip)
}

export async function openLanFile(filePath: string): Promise<void> {
  await native().lan?.openFile(filePath)
}

export async function showLanFileInFolder(filePath: string): Promise<void> {
  await native().lan?.showInFolder(filePath)
}

// 注册到全局 window，方便开发者随时在控制台或外部脚本调用与测试
if (typeof window !== 'undefined') {
  ;(window as unknown as { requestDeviceFile: typeof requestDeviceFile }).requestDeviceFile = requestDeviceFile
}

const DEFAULT_STATUS: LanServerStatus = {
  running: false,
  port: 51888,
  ipList: ['127.0.0.1'],
  selectedIp: '127.0.0.1',
  qrUrl: '',
  devices: [],
  files: [],
}

/**
 * React Hook：订阅局域网服务运行状态、已连接设备列表与上传文件列表
 */
export function useLanServer() {
  const [status, setStatus] = useState<LanServerStatus>(DEFAULT_STATUS)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const s = await getLanStatus()
    if (s) {
      setStatus(s)
    }
  }, [])

  useEffect(() => {
    const bridge = native().lan
    if (!bridge) return

    let mounted = true
    void (async () => {
      const s = await getLanStatus()
      if (mounted && s) {
        setStatus(s)
      }
    })()

    const unStatus = bridge.onStatusChange((newStatus) => {
      setStatus(newStatus)
    })

    const unFile = bridge.onFileReceived((file) => {
      setStatus((prev) => ({
        ...prev,
        files: [file, ...prev.files.filter((f) => f.id !== file.id)],
      }))
    })

    const unDev = bridge.onDevicesChange((devices) => {
      setStatus((prev) => ({
        ...prev,
        devices,
      }))
    })

    return () => {
      mounted = false
      unStatus()
      unFile()
      unDev()
    }
  }, [refresh])

  const start = useCallback(async (port?: number) => {
    setLoading(true)
    try {
      const res = await startLanServer(port)
      if (res) setStatus(res)
      return res
    } finally {
      setLoading(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setLoading(true)
    try {
      await stopLanServer()
      await refresh()
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const selectIp = useCallback(async (ip: string) => {
    const res = await setSelectedLanIp(ip)
    if (res) setStatus(res)
  }, [])

  return {
    status,
    loading,
    refresh,
    start,
    stop,
    selectIp,
    requestFile: requestDeviceFile,
  }
}
