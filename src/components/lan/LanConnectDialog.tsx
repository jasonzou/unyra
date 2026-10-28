import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  FileCheck,
  FileIcon,
  FileImage,
  FileText,
  FolderOpen,
  Loader2,
  Power,
  Send,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react'
import ModalScrim from '../ModalScrim'
import { useEscapeKey } from '../../lib/useEscape'
import { t } from '../../i18n'
import QRCode from 'qrcode'
import {
  openLanFile,
  showLanFileInFolder,
  useLanServer,
  type LanUploadedFile,
} from '../../lib/lanSync'

interface Props {
  open: boolean
  onClose: () => void
  onToast?: (msg: string) => void
}

export default function LanConnectDialog({ open, onClose, onToast }: Props) {
  const { status, loading, start, stop, selectIp, requestFile } = useLanServer()

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)

  // API 意图测试状态
  const [testPrompt, setTestPrompt] = useState('请拍摄或选取学习笔记/错题照片')
  const [testAccept, setTestAccept] = useState('image/*')
  const [requesting, setRequesting] = useState(false)
  const [lastApiResult, setLastApiResult] = useState<LanUploadedFile | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  // Esc 键关闭
  useEscapeKey(() => {
    if (open) onClose()
  })

  // 默认打开弹窗且服务未启动时，自动尝试启动局域网服务
  useEffect(() => {
    if (open && !status.running && !loading) {
      void start()
    }
  }, [open, status.running, loading, start])

  // 生成二维码
  useEffect(() => {
    let active = true
    if (!open || !status.running || !status.qrUrl) {
      return () => {
        active = false
      }
    }

    void QRCode.toDataURL(status.qrUrl, {
      margin: 2,
      width: 260,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrCodeDataUrl(url)
      })
      .catch((err) => {
        console.error('QR code generation failed:', err)
      })

    return () => {
      active = false
    }
  }, [open, status.running, status.qrUrl])

  // 复制直连地址
  const handleCopyUrl = async () => {
    if (!status.qrUrl) return
    try {
      await navigator.clipboard.writeText(status.qrUrl)
      setCopied(true)
      onToast?.(t('已复制局域网直连地址到剪贴板'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onToast?.(t('复制失败，请手动选择复制'))
    }
  }

  // 测试发布意图 API
  const handleTestRequest = async () => {
    if (status.devices.length === 0) {
      onToast?.(t('当前没有移动设备连接，请先用手机扫码连接'))
      return
    }

    setRequesting(true)
    setApiError(null)
    setLastApiResult(null)

    try {
      const res = await requestFile({
        prompt: testPrompt.trim() || undefined,
        accept: testAccept || undefined,
        timeoutMs: 120000, // 2分钟测试超时
      })

      if (res.ok && res.file) {
        setLastApiResult(res.file)
        onToast?.(t('成功接收到手机上传的文件！'))
      } else {
        setApiError(res.error || t('获取文件失败'))
        onToast?.(res.error || t('获取文件失败'))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setApiError(msg)
      onToast?.(msg)
    } finally {
      setRequesting(false)
    }
  }

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // 格式化时间
  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  // 文件图标
  const getFileIcon = (file: LanUploadedFile) => {
    if (file.mime.startsWith('image/')) return <FileImage size={18} className="text-sky-500" />
    if (file.name.endsWith('.pdf')) return <FileText size={18} className="text-red-500" />
    if (file.mime.includes('text') || file.name.endsWith('.md')) return <FileText size={18} className="text-emerald-500" />
    return <FileIcon size={18} className="text-indigo-400" />
  }

  if (!open) return null

  return (
    <ModalScrim z="z-[60]" onClose={onClose}>
      <div
        role="dialog"
        aria-label={t('局域网互联传输')}
        className="moji-dialog-in flex h-[620px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
      >
        {/* 顶部标题栏 */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-500">
              <Smartphone size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-ink-strong">{t('局域网互联 · 移动端传文件')}</h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    status.running
                      ? 'bg-emerald-500/12 text-emerald-500'
                      : 'bg-zinc-500/15 text-ink-soft'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status.running ? 'bg-emerald-500' : 'bg-zinc-400'
                    }`}
                  />
                  {status.running ? t('服务运行中') : t('服务已停止')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (status.running ? stop() : start())}
              disabled={loading}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
                status.running
                  ? 'bg-rose-500/10 text-rose-500 hover:bg-rose-500/20'
                  : 'bg-sky-500/15 text-sky-500 hover:bg-sky-500/25'
              }`}
            >
              <Power size={13} />
              {status.running ? t('关闭服务') : t('启动服务')}
            </button>

            <button
              type="button"
              title={t('关闭')}
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/70 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 主体两栏内容 */}
        <div className="flex min-h-0 flex-1 divide-x divide-line">
          {/* 左侧：扫码直连与 API 意图触发 */}
          <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto p-5">
            {/* 二维码卡片 */}
            <div className="flex flex-col items-center rounded-xl border border-line bg-layer-1/50 p-4 text-center">
              {status.running ? (
                <>
                  <div className="relative overflow-hidden rounded-xl bg-white p-3 shadow-md">
                    {qrCodeDataUrl ? (
                      <img
                        src={qrCodeDataUrl}
                        alt="局域网直连二维码"
                        className="h-[180px] w-[180px]"
                      />
                    ) : (
                      <div className="flex h-[180px] w-[180px] items-center justify-center">
                        <Loader2 className="animate-spin text-sky-500" size={24} />
                      </div>
                    )}
                  </div>
                  <p className="mt-2.5 text-[12px] font-medium text-ink-soft">
                    {t('手机浏览器或微信扫码直接连接')}
                  </p>
                  <p className="text-[11px] text-ink-soft/70">
                    {t('无需安装 App，手机电脑保持在同一 WiFi 局域网')}
                  </p>

                  {/* 局域网直连地址与多网卡选择 */}
                  <div className="mt-3 flex w-full flex-col gap-1.5">
                    {status.ipList.length > 1 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                        <Wifi size={12} />
                        <span>{t('网卡 IP:')}</span>
                        <select
                          value={status.selectedIp}
                          onChange={(e) => void selectIp(e.target.value)}
                          className="flex-1 rounded border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink"
                        >
                          {status.ipList.map((ip) => (
                            <option key={ip} value={ip}>
                              {ip}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex items-center justify-between rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px]">
                      <span className="truncate font-mono text-ink-soft">{status.qrUrl}</span>
                      <button
                        type="button"
                        onClick={handleCopyUrl}
                        className="ml-2 flex shrink-0 items-center gap-1 text-sky-500 hover:text-sky-600"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? t('已复制') : t('复制')}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-ink-soft">
                  <Power size={32} className="opacity-40" />
                  <p className="text-[13px]">{t('局域网服务器未启动')}</p>
                  <button
                    type="button"
                    onClick={() => void start()}
                    className="mt-1 rounded-lg bg-sky-500 px-4 py-1.5 text-[12px] font-medium text-white shadow hover:bg-sky-600"
                  >
                    {t('一键启动')}
                  </button>
                </div>
              )}
            </div>

            {/* 已连接设备 */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-ink-soft">
                <span>{t('已连接设备')} ({status.devices.length})</span>
                {status.devices.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {t('就绪')}
                  </span>
                )}
              </div>

              {status.devices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line p-3 text-center text-[12px] text-ink-soft/70">
                  {t('暂无连接的设备，请用手机扫码')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {status.devices.map((dev) => (
                    <div
                      key={dev.id}
                      className="flex items-center justify-between rounded-lg border border-line bg-layer-1/60 px-3 py-2 text-[12px]"
                    >
                      <div className="flex items-center gap-2">
                        <Smartphone size={14} className="text-sky-500" />
                        <div>
                          <div className="font-medium text-ink">{dev.name}</div>
                          <div className="text-[10px] text-ink-soft font-mono">{dev.ip}</div>
                        </div>
                      </div>
                      <span className="text-[10px] text-ink-soft">{formatTime(dev.joinedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 核心功能：向设备发布意图 API 模拟测试 */}
            <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-sky-600 dark:text-sky-400">
                  {t('内部 API: requestDeviceFile')}
                </span>
                <span className="text-[10px] text-ink-soft">{t('意图调用')}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-soft mb-2.5">
                {t('软件内部调用此 API 时，将通过服务器向手机发布上传意图，手机端弹出提示并上传后作为返回值返回。')}
              </p>

              <div className="space-y-2">
                <div>
                  <label className="text-[11px] text-ink-soft block mb-1">{t('意图提示语 (prompt):')}</label>
                  <input
                    type="text"
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    placeholder={t('如：请拍摄本题手写笔记')}
                    className="w-full rounded-md border border-line bg-paper px-2.5 py-1 text-[12px] text-ink"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-ink-soft block mb-1">{t('文件格式限制 (accept):')}</label>
                  <select
                    value={testAccept}
                    onChange={(e) => setTestAccept(e.target.value)}
                    className="w-full rounded-md border border-line bg-paper px-2 py-1 text-[12px] text-ink"
                  >
                    <option value="">{t('任意文件 (*)')}</option>
                    <option value="image/*">{t('图片/相册/拍照 (image/*)')}</option>
                    <option value="application/pdf">{t('PDF 文档 (.pdf)')}</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleTestRequest}
                  disabled={requesting || status.devices.length === 0}
                  className={`mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium transition ${
                    status.devices.length === 0
                      ? 'bg-line text-ink-soft cursor-not-allowed'
                      : requesting
                      ? 'bg-sky-500/30 text-sky-500 cursor-wait'
                      : 'bg-sky-500 text-white shadow hover:bg-sky-600'
                  }`}
                >
                  {requesting ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      {t('已发布意图，等待手机上传...')}
                    </>
                  ) : (
                    <>
                      <Send size={13} />
                      {t('发布意图并等待手机返回')}
                    </>
                  )}
                </button>

                {/* API 返回结果预览 */}
                {lastApiResult && (
                  <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-[11px]">
                    <div className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                      <FileCheck size={14} />
                      {t('API 成功返回文件:')}
                    </div>
                    <div className="mt-1 truncate font-medium text-ink">{lastApiResult.name}</div>
                    <div className="text-[10px] text-ink-soft">
                      {formatSize(lastApiResult.size)} · {lastApiResult.path}
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void openLanFile(lastApiResult.path)}
                        className="text-sky-500 hover:underline"
                      >
                        {t('打开文件')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void showLanFileInFolder(lastApiResult.path)}
                        className="text-sky-500 hover:underline"
                      >
                        {t('在文件夹中显示')}
                      </button>
                    </div>
                  </div>
                )}

                {apiError && (
                  <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-500">
                    {apiError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：已接收文件列表与显示 */}
          <div className="flex flex-1 flex-col overflow-hidden p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-semibold text-ink-strong">{t('已接收文件')}</h3>
                <p className="text-[11px] text-ink-soft">
                  {t('手机端主动上传或意图响应的文件将实时保存在本机并列出')}
                </p>
              </div>
              <span className="rounded-full bg-line px-2.5 py-0.5 text-[11px] text-ink-soft">
                {t('{0} 项', String(status.files.length))}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {status.files.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-soft/70">
                  <FileIcon size={36} className="opacity-30" />
                  <p className="text-[13px]">{t('暂无接收到的文件')}</p>
                  <p className="text-[11px] text-ink-soft/50">
                    {t('手机扫码连接后，选择照片或文档上传')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {status.files.map((file) => (
                    <div
                      key={file.id}
                      className="group flex items-center justify-between rounded-xl border border-line bg-layer-1/50 p-3 transition hover:border-line-strong hover:bg-layer-1"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper border border-line shadow-xs">
                          {getFileIcon(file)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-ink" title={file.name}>
                              {file.name}
                            </span>
                            {file.requestId && (
                              <span className="rounded bg-sky-500/15 px-1.5 py-0.2 text-[10px] text-sky-500">
                                {t('响应意图')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-ink-soft">
                            <span>{formatSize(file.size)}</span>
                            <span>•</span>
                            <span>{formatTime(file.uploadTime)}</span>
                            {file.deviceName && (
                              <>
                                <span>•</span>
                                <span>{file.deviceName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 opacity-90 transition group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void openLanFile(file.path)}
                          title={t('直接打开文件')}
                          className="flex h-7 items-center gap-1 rounded-md border border-line bg-paper px-2 text-[11px] font-medium text-ink shadow-xs transition hover:bg-line/60"
                        >
                          <ExternalLink size={12} />
                          {t('打开')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void showLanFileInFolder(file.path)}
                          title={t('在资源管理器中打开所在文件夹')}
                          className="flex h-7 items-center gap-1 rounded-md border border-line bg-paper px-2 text-[11px] font-medium text-ink shadow-xs transition hover:bg-line/60"
                        >
                          <FolderOpen size={12} />
                          {t('定位')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ModalScrim>
  )
}
