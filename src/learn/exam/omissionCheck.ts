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

const SYSTEM_PROMPT = `你是一名负责考场手写答卷预检的细致小助手。
学习者上传了若干张手写答卷照片，准备提交试卷。你的唯一任务是：对照整份试卷的题目列表，快速审视手写答卷照片，检查学习者是否存在明显漏写、未作答的题目。

请严格返回合法 JSON 对象，格式如下：
{
  "hasOmissions": boolean,
  "missingQuestions": number[],
  "reason": "简要说明遗漏情况"
}

重要判定准则：
1. missingQuestions 必须是试卷题目序号数组（题号从 1 开始，如 [7, 21]）。
2. 只要学习者写了答案、推导步骤、选项字母、算式，哪怕写了“不会”、“不知道”、“跳过”，都算已作答，绝不属于遗漏。
3. 只有当答卷上完全没有写这道题的编号，或者该题编号后一片空白没有任何作答痕迹时，才判定为遗漏。
4. 如果所有题目均有作答痕迹，hasOmissions 必须为 false，missingQuestions 必须为 []。
5. 保持严格客观、快速判断，不要进行深度判分或纠错。`

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

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) return null

  return imagePart(match[1], match[2])
}

/**
 * 试卷提交前预检：通过快速视觉 Agent 识别手写答卷中是否有遗漏未作答题目
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

    const userPrompt = `整份试卷《${exam.title}》共有 ${exam.questions.length} 道题：\n${questionListText}\n\n附件为学习者上传的 ${imageParts.length} 张手写答卷照片。请检查是否有明显漏做的题目。`

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
