import { chatCompleteWith } from '../../ai/client'
import { imagePart, textPart } from '../../ai/content'
import type { ChatContentPart } from '../../ai/types'
import { hasApiKey, loadAiSettings, resolveGlobal } from '../../ai/settings'
import { readLocalImage } from '../../lib/localFiles'
import type { ExamQuestion } from './types'
import { QUESTION_TYPE_LABEL } from './view'

export interface OmissionCheckResult {
  hasOmissions: boolean
  missingQuestions: number[]
  reason?: string
}

const SYSTEM_PROMPT = `你是一名负责考场手写答卷预检的细致助手【检题助手】。
学习者上传了若干张手写答卷照片，准备提交试卷。你的唯一任务是：对照整份试卷的题目列表，快速审视手写答卷照片，检查学习者是否存在明显漏写、未作答的题目。

请严格返回合法 JSON 对象，格式如下：
{
  "hasOmissions": boolean,
  "missingQuestions": number[],
  "reason": "简要说明遗漏情况"
}

重要判定准则：
1. missingQuestions 必须是试卷题目序号数组（题号从 1 开始，如 [7, 21]）。
2. 注意照片角度：学习者拍照可能存在旋转、倾斜、横置或倒立角度，请多方向综合审阅。
3. 只要答卷上有任何作答内容、推导公式、计算过程、选择题选项字母（如 A、B、C、D、对、错、√、×）或文字，哪怕写了“不会”、“跳过”，都算已作答，绝不属于遗漏。
4. 严禁误判：如果答卷上有书写笔迹与作答痕迹，但因草稿排版紧凑或未严格标清题号而难以精准对应，切勿轻易判定为“全部未做”！只要有实质作答笔迹，判定 hasOmissions 为 false，missingQuestions 为 []，交给主阅卷导师深度判阅。
5. 只有当某道题在整张答卷上确实完全没有任何作答痕迹时，才判定为遗漏。
6. 如果所有题目均有作答痕迹，hasOmissions 必须为 false，missingQuestions 必须为 []。
7. 保持客观快速判断，不要进行深度判分或纠错。`

/**
 * 在浏览器/渲染进程中适度等比例压缩超大照片，避免几兆的原图冲垮多模态上下文或超时
 */
function downscaleImage(dataUrl: string, maxDimension = 1600): Promise<string> {
  if (typeof document === 'undefined') return Promise.resolve(dataUrl)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      let { width, height } = img
      if (width <= maxDimension && height <= maxDimension) {
        return resolve(dataUrl)
      }
      if (width > height) {
        height = Math.round((height * maxDimension) / width)
        width = maxDimension
      } else {
        width = Math.round((width * maxDimension) / height)
        height = maxDimension
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * 将本地图片路径或 dataURL 转换为 ChatContentPart
 */
async function toImagePart(pathOrUrl: string): Promise<ChatContentPart | null> {
  if (!pathOrUrl) return null

  let dataUrl = pathOrUrl
  if (!pathOrUrl.startsWith('data:')) {
    const loaded = await readLocalImage(pathOrUrl).catch(() => null)
    if (!loaded) return null
    dataUrl = loaded
  }

  // 压缩大图，避免十几兆手机高像素原图导致请求超时或解析失败
  dataUrl = await downscaleImage(dataUrl).catch(() => dataUrl)

  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim())
  if (!match) return null

  return imagePart(match[1], match[2])
}

/**
 * 试卷提交前预检：由【检题助手】识别手写答卷中是否有遗漏未作答题目
 */
export async function checkExamOmissions(opts: {
  exam: { title: string; questions: ExamQuestion[] }
  images: string[]
  signal?: AbortSignal
}): Promise<OmissionCheckResult> {
  const { exam, images, signal } = opts
  if (!images.length) {
    return { hasOmissions: false, missingQuestions: [] }
  }

  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    // 未配置 API Key 时静默放行，不阻碍交卷
    return { hasOmissions: false, missingQuestions: [] }
  }

  try {
    const { provider, model } = resolveGlobal(settings)

    // 读取所有图片并组装多模态消息
    const imageParts: ChatContentPart[] = []
    for (const img of images) {
      const part = await toImagePart(img)
      if (part) imageParts.push(part)
    }

    if (!imageParts.length) {
      return { hasOmissions: false, missingQuestions: [] }
    }

    const questionListText = exam.questions
      .map(
        (q, i) =>
          `${i + 1}. [${QUESTION_TYPE_LABEL[q.type] || q.type}] ${q.stem.slice(0, 50).replace(/\s+/g, ' ')}`,
      )
      .join('\n')

    const userPrompt = `整份试卷《${exam.title}》共有 ${exam.questions.length} 道题：\n${questionListText}\n\n附件为学习者上传的 ${imageParts.length} 张手写答卷照片。请检题助手检查是否有明显漏做的题目。`

    const userContent: ChatContentPart[] = [textPart(userPrompt), ...imageParts]

    const raw = await chatCompleteWith(provider, model, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      json: true,
      reasoningEffort: 'low',
      maxTokens: 512,
      signal,
      purpose: 'other',
    })

    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(cleaned) as {
      hasOmissions?: boolean
      missingQuestions?: unknown[]
      reason?: string
    }

    const missingQuestions = Array.isArray(parsed.missingQuestions)
      ? parsed.missingQuestions
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= exam.questions.length)
      : []

    const hasOmissions = !!parsed.hasOmissions && missingQuestions.length > 0

    return {
      hasOmissions,
      missingQuestions,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
    }
  } catch {
    // 任何异常或超时情况下，均兜底放行，不阻止用户正常交卷
    return { hasOmissions: false, missingQuestions: [] }
  }
}
