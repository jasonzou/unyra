/**
 * 数据 Schema 版本探测与元数据管理。
 *
 * 从当前版本 (0.6.3) 开始增加持久化版本标识：
 * - 用户的每个数据目录（users/{uid}/）下拥有独立的 schema.json，记录 schemaVersion 与迁移历史；
 * - state.json 同步盖印 schemaVersion；
 * - 后续版本升级时，数据迁移页面将根据此标识判断数据属于哪个版本，并执行对应链式迁移。
 */

import { readJson, userRel, writeJson } from '../storage'
import type { SchemaMeta } from './types'

export const LATEST_SCHEMA_VERSION = '0.6.3'

export const SCHEMA_FILE = 'schema.json'
export const STATE_FILE = 'state.json'

/** 版本号比对：v1 < v2 返回 -1，v1 === v2 返回 0，v1 > v2 返回 1 */
export function compareVersions(v1: string, v2: string): number {
  const p1 = v1.split('.').map((n) => parseInt(n, 10) || 0)
  const p2 = v2.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(p1.length, p2.length)
  for (let i = 0; i < len; i++) {
    const a = p1[i] ?? 0
    const b = p2[i] ?? 0
    if (a < b) return -1
    if (a > b) return 1
  }
  return 0
}

/** 探测并确保指定用户的当前存储结构版本号与元数据 */
export async function detectSchemaVersion(uid: string): Promise<{
  version: string
  isExplicit: boolean
  meta?: SchemaMeta
}> {
  // 1. 读取本版本引入的显式 schema.json
  const schemaPath = userRel(uid, SCHEMA_FILE)
  const meta = await readJson<SchemaMeta>(schemaPath)
  if (meta && typeof meta.schemaVersion === 'string' && meta.schemaVersion.trim()) {
    return {
      version: meta.schemaVersion.trim(),
      isExplicit: true,
      meta,
    }
  }

  // 2. 检查 state.json 中是否已有 schemaVersion
  const statePath = userRel(uid, STATE_FILE)
  const state = await readJson<Record<string, unknown>>(statePath)
  const existingVer =
    state && typeof state.schemaVersion === 'string' && state.schemaVersion.trim()
      ? state.schemaVersion.trim()
      : LATEST_SCHEMA_VERSION

  // 3. 从本版本开始增加标识：如果尚未创建 schema.json，自动初始化基准元数据
  const initialMeta: SchemaMeta = {
    schemaVersion: existingVer,
    updatedAt: Date.now(),
    history: [],
  }
  await saveSchemaMeta(uid, initialMeta)

  return {
    version: existingVer,
    isExplicit: true,
    meta: initialMeta,
  }
}

/** 保存 schema.json 并同步标记 state.json */
export async function saveSchemaMeta(uid: string, meta: SchemaMeta): Promise<boolean> {
  const schemaPath = userRel(uid, SCHEMA_FILE)
  const ok = await writeJson(schemaPath, meta)

  // 顺带同步印入 state.json 形成双重校验保障
  const statePath = userRel(uid, STATE_FILE)
  const state = await readJson<Record<string, unknown>>(statePath)
  if (state && typeof state === 'object') {
    await writeJson(statePath, {
      ...state,
      schemaVersion: meta.schemaVersion,
      schemaUpdatedAt: meta.updatedAt,
    })
  }

  return ok
}
