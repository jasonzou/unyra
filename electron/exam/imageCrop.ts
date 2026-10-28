import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import { getUserDataDir } from '../storage/userData'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type CropBoxInput =
  | [number, number, number, number]
  | { x: number; y: number; width: number; height: number }
  | { ymin: number; xmin: number; ymax: number; xmax: number }

export interface CropImageResult {
  ok: boolean
  croppedPath?: string
  dataUrl?: string
  error?: string
}

/**
 * 将任意格式的 box 转换为图像像素级别的 { x, y, width, height }
 * 兼容：
 * - [ymin, xmin, ymax, xmax] (0~1000 范围，大模型常用格式)
 * - [ymin, xmin, ymax, xmax] (0~1 比例)
 * - [x, y, width, height] (绝对像素)
 * - { x, y, width, height }
 * - { ymin, xmin, ymax, xmax }
 */
export function normalizeCropRect(
  box: CropBoxInput,
  imgWidth: number,
  imgHeight: number,
): CropRect {
  let x = 0
  let y = 0
  let width = imgWidth
  let height = imgHeight

  if (Array.isArray(box)) {
    const [a, b, c, d] = box
    const maxVal = Math.max(a, b, c, d)

    if (maxVal <= 1) {
      // 0~1 比例的 [ymin, xmin, ymax, xmax]
      const ymin = Math.max(0, a * imgHeight)
      const xmin = Math.max(0, b * imgWidth)
      const ymax = Math.min(imgHeight, c * imgHeight)
      const xmax = Math.min(imgWidth, d * imgWidth)
      x = xmin
      y = ymin
      width = Math.max(1, xmax - xmin)
      height = Math.max(1, ymax - ymin)
    } else if (maxVal <= 1000) {
      // 0~1000 范围的 [ymin, xmin, ymax, xmax] (大模型通用视觉检测格式)
      const ymin = Math.max(0, (a / 1000) * imgHeight)
      const xmin = Math.max(0, (b / 1000) * imgWidth)
      const ymax = Math.min(imgHeight, (c / 1000) * imgHeight)
      const xmax = Math.min(imgWidth, (d / 1000) * imgWidth)
      x = xmin
      y = ymin
      width = Math.max(1, xmax - xmin)
      height = Math.max(1, ymax - ymin)
    } else {
      // 认为是 [x, y, width, height] 或 [xmin, ymin, xmax, ymax]
      if (c > a && d > b && c <= imgWidth && d <= imgHeight) {
        // [xmin, ymin, xmax, ymax]
        x = a
        y = b
        width = Math.max(1, c - a)
        height = Math.max(1, d - b)
      } else {
        // [x, y, width, height]
        x = a
        y = b
        width = c
        height = d
      }
    }
  } else if ('ymin' in box && 'xmin' in box) {
    const maxVal = Math.max(box.ymin, box.xmin, box.ymax, box.xmax)
    const scale = maxVal <= 1 ? 1 : maxVal <= 1000 ? 1000 : imgWidth
    const ymin = (box.ymin / scale) * imgHeight
    const xmin = (box.xmin / scale) * imgWidth
    const ymax = (box.ymax / scale) * imgHeight
    const xmax = (box.xmax / scale) * imgWidth
    x = Math.max(0, xmin)
    y = Math.max(0, ymin)
    width = Math.max(1, Math.min(imgWidth - x, xmax - xmin))
    height = Math.max(1, Math.min(imgHeight - y, ymax - ymin))
  } else if ('x' in box && 'width' in box) {
    x = box.x
    y = box.y
    width = box.width
    height = box.height
  }

  // 边界约束
  x = Math.max(0, Math.min(imgWidth - 1, Math.round(x)))
  y = Math.max(0, Math.min(imgHeight - 1, Math.round(y)))
  width = Math.max(1, Math.min(imgWidth - x, Math.round(width)))
  height = Math.max(1, Math.min(imgHeight - y, Math.round(height)))

  return { x, y, width, height }
}

/**
 * 裁剪手写答案图片并存储到用户数据目录
 */
export async function cropExamAnswerImage(
  imagePath: string,
  box: CropBoxInput,
): Promise<CropImageResult> {
  try {
    let image: Electron.NativeImage
    if (imagePath.startsWith('data:')) {
      image = nativeImage.createFromDataURL(imagePath)
    } else {
      if (!fs.existsSync(imagePath)) {
        return { ok: false, error: '源图片不存在: ' + imagePath }
      }
      image = nativeImage.createFromPath(imagePath)
    }
    if (image.isEmpty()) {
      return { ok: false, error: '无法读取源图片或图片已损坏' }
    }

    const size = image.getSize()
    const rect = normalizeCropRect(box, size.width, size.height)

    const cropped = image.crop(rect)
    if (cropped.isEmpty()) {
      return { ok: false, error: '裁切失败，区域为空' }
    }

    const targetDir = path.join(getUserDataDir(), 'exam-crops')
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const fileName = `crop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`
    const targetPath = path.join(targetDir, fileName)

    const pngBuffer = cropped.toPNG()
    fs.writeFileSync(targetPath, pngBuffer)

    const dataUrl = cropped.toDataURL()

    return {
      ok: true,
      croppedPath: targetPath,
      dataUrl,
    }
  } catch (err: unknown) {
    return { ok: false, error: `裁剪图片失败: ${String(err)}` }
  }
}
