import { describe, expect, it } from 'vitest'
import { normalizeCropRect } from '../electron/exam/imageCrop'
import { hasAnswerValue } from '../src/learn/exam/grade'
import { recordInput, newAttempt } from '../src/learn/examRecords'
import {
  attachCroppedAnswerImage,
  attachHandwrittenImages,
  applyGradeResult,
  upsertAttempt,
} from '../src/learn/graph/exams'
import type { Exam, ExamAttempt } from '../src/learn/exam/types'
import type { LearnStore } from '../src/learn/types'

const T0 = 1_700_000_000_000

const mockExam: Exam = {
  id: 'e_crop_test',
  nodeId: 'node_1',
  goalId: 'goal_1',
  title: '手写答案考试',
  kind: 'exam',
  level: 'hard',
  minutes: 60,
  createdAt: T0,
  attempts: [],
  questions: [
    {
      id: 'q1',
      type: 'short',
      stem: '简述微积分基本定理的几何意义',
      points: 10,
    },
    {
      id: 'q2',
      type: 'fill',
      stem: '导数的物理意义是______',
      points: 5,
    },
  ],
}

function makeInitialStore(): LearnStore {
  const node = {
    id: 'node_1',
    goalId: 'goal_1',
    title: '微积分',
    key: '微积分',
    description: '',
    docs: { teaching: '微积分正文' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    createdAt: T0,
    updatedAt: T0,
  }
  return {
    version: 2,
    nodes: [node],
    edges: [],
    goals: [
      {
        id: 'goal_1',
        rootNodeId: 'node_1',
        question: '学微积分',
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    exams: [mockExam],
    conversations: [],
  } as unknown as LearnStore
}

describe('手写答案坐标换算与归一化 (normalizeCropRect)', () => {
  it('大模型标准 0~1000 范围 [ymin, xmin, ymax, xmax] 自适应换算', () => {
    const imgWidth = 2000
    const imgHeight = 1000
    // [ymin: 100, xmin: 200, ymax: 600, xmax: 800]
    const rect = normalizeCropRect([100, 200, 600, 800], imgWidth, imgHeight)

    expect(rect).toEqual({
      x: 400, // (200 / 1000) * 2000 = 400
      y: 100, // (100 / 1000) * 1000 = 100
      width: 1200, // ((800 - 200) / 1000) * 2000 = 1200
      height: 500, // ((600 - 100) / 1000) * 1000 = 500
    })
  })

  it('0~1 比例范围 [ymin, xmin, ymax, xmax] 自适应换算', () => {
    const imgWidth = 1920
    const imgHeight = 1080
    const rect = normalizeCropRect([0.1, 0.2, 0.6, 0.7], imgWidth, imgHeight)

    expect(rect.x).toBe(Math.round(0.2 * 1920))
    expect(rect.y).toBe(Math.round(0.1 * 1080))
    expect(rect.width).toBe(Math.round((0.7 - 0.2) * 1920))
    expect(rect.height).toBe(Math.round((0.6 - 0.1) * 1080))
  })

  it('像素级对象 { x, y, width, height } 原样保留并进行边界约束', () => {
    const imgWidth = 800
    const imgHeight = 600
    const rect = normalizeCropRect({ x: 50, y: 60, width: 300, height: 400 }, imgWidth, imgHeight)

    expect(rect).toEqual({
      x: 50,
      y: 60,
      width: 300,
      height: 400,
    })

    // 超出边界约束
    const outRect = normalizeCropRect({ x: 700, y: 500, width: 500, height: 500 }, imgWidth, imgHeight)
    expect(outRect.x).toBe(700)
    expect(outRect.y).toBe(500)
    expect(outRect.width).toBe(100) // 800 - 700
    expect(outRect.height).toBe(100) // 600 - 500
  })

  it('结构化对象 { ymin, xmin, ymax, xmax } 转换', () => {
    const imgWidth = 1000
    const imgHeight = 1000
    const rect = normalizeCropRect({ ymin: 150, xmin: 50, ymax: 450, xmax: 950 }, imgWidth, imgHeight)

    expect(rect).toEqual({
      x: 50,
      y: 150,
      width: 900,
      height: 300,
    })
  })
})

describe('手写答案判分有效性与输入记录流 (hasAnswerValue & recordInput)', () => {
  it('只要附带手写答案图片即判定为已作答', () => {
    expect(hasAnswerValue({ questionId: 'q1', value: [] })).toBe(false)
    expect(hasAnswerValue({ questionId: 'q1', value: [], text: '   ' })).toBe(false)
    expect(hasAnswerValue({ questionId: 'q1', value: [], image: 'data:image/png;base64,...' })).toBe(true)
    expect(hasAnswerValue({ questionId: 'q1', value: [], image: 'C:/transfers/shot1.png' })).toBe(true)
  })

  it('recordInput 记录手写答案图片并汇总到全卷 handwrittenImages', () => {
    let attempt = newAttempt('att_1', T0, false)
    attempt = recordInput(attempt, mockExam, {
      questionId: 'q1',
      value: [],
      text: '见手写计算过程',
      image: 'C:/transfers/q1_handwritten.png',
      rawImage: 'C:/transfers/sheet_raw_1.png',
      at: T0 + 1000,
    })

    expect(attempt.answers).toHaveLength(1)
    expect(attempt.answers[0].questionId).toBe('q1')
    expect(attempt.answers[0].text).toBe('见手写计算过程')
    expect(attempt.answers[0].image).toBe('C:/transfers/q1_handwritten.png')
    expect(attempt.answers[0].rawImage).toBe('C:/transfers/sheet_raw_1.png')

    // 自动追加至 handwrittenImages
    expect(attempt.handwrittenImages).toContain('C:/transfers/sheet_raw_1.png')
  })
})

describe('Agent 裁切工具与试卷回看贴题关联 (attachCroppedAnswerImage & attachHandwrittenImages)', () => {
  it('attachCroppedAnswerImage 将裁剪后的手写图片精准绑定至题目结果与答案', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_crop_1',
      startedAt: T0,
      status: 'submitted',
      answers: [{ questionId: 'q1', value: [] }],
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
      results: [
        {
          questionId: 'q1',
          correct: true,
          score: 10,
          maxScore: 10,
          by: 'agent',
        },
      ],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    const croppedPath = 'C:/Users/test/exam-crops/crop_q1_math.png'
    const nextStore = attachCroppedAnswerImage(store, mockExam.id, 'att_crop_1', 'q1', croppedPath)

    const updatedAttempt = nextStore.exams[0].attempts[0]
    expect(updatedAttempt.results?.[0].croppedAnswerImage).toBe(croppedPath)
    expect(updatedAttempt.answers[0].image).toBe(croppedPath)
  })

  it('attachHandwrittenImages 支持多次追加且自动去重', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_handwritten_1',
      startedAt: T0,
      status: 'submitted',
      answers: [],
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
      handwrittenImages: ['img_a.png'],
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    const nextStore = attachHandwrittenImages(store, mockExam.id, 'att_handwritten_1', ['img_b.png', 'img_a.png', 'img_c.png'])
    const updated = nextStore.exams[0].attempts[0]

    expect(updated.handwrittenImages).toEqual(['img_a.png', 'img_b.png', 'img_c.png'])
  })

  it('applyGradeResult 支持直接写入 croppedAnswerImage', () => {
    let store = makeInitialStore()
    const attempt: ExamAttempt = {
      id: 'att_grade_1',
      startedAt: T0,
      status: 'submitted',
      answers: [{ questionId: 'q1', value: [], image: 'raw.png' }],
      inputs: [],
      dwell: {},
      blurs: [],
      forceSubmit: false,
    }
    store = upsertAttempt(store, mockExam.id, attempt)

    const croppedAnswerImage = 'C:/userData/exam-crops/q1_crop.png'
    const res = applyGradeResult(store, mockExam.id, 'att_grade_1', {
      passed: true,
      summary: '全部正确',
      results: [
        {
          questionId: 'q1',
          correct: true,
          score: 10,
          comment: '推导步骤清晰完备',
          croppedAnswerImage,
        },
      ],
    })

    expect(res.ok).toBe(true)
    const graded = res.store.exams[0].attempts[0]
    expect(graded.status).toBe('graded')
    expect(graded.results?.[0].croppedAnswerImage).toBe(croppedAnswerImage)
  })
})
