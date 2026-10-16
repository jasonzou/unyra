/**
 * 链式数据迁移系统契约定义。
 *
 * 核心目标：
 * 1. 规避散落在代码各处、随版本迭代逐渐臃肿混乱的 ad-hoc 迁移代码；
 * 2. 链式拓扑规划：无论用户从哪个历史版本跨越升级（如 0.5.0 -> 0.6.3），
 *    自动规划最优迁移链路并顺序逐步执行（0.5.0 -> 0.5.6 -> 0.6.2 -> 0.6.3）；
 * 3. 显式版本溯源：通过 schema.json 记录当前版本、迁移时间戳与各阶段执行历史。
 */

import type { StorageEntry } from '../native'

export interface MigrationContext {
  uid: string
  userDir: string
  storage: {
    readJson: <T>(rel: string) => Promise<T | null>
    writeJson: (rel: string, data: unknown) => Promise<boolean>
    readYaml: <T>(rel: string) => Promise<T | null>
    writeYaml: (rel: string, data: unknown) => Promise<boolean>
    readText: (rel: string) => Promise<string | null>
    writeText: (rel: string, content: string) => Promise<boolean>
    listDir: (rel: string) => Promise<StorageEntry[]>
    removePath: (rel: string) => Promise<boolean>
    mkdir: (rel: string) => Promise<boolean>
  }
  log: (msg: string) => void
}

export interface MigrationStepResult {
  ok: boolean
  fromVersion: string
  toVersion: string
  modifiedFiles: string[]
  details?: string
  error?: string
}

export interface MigrationScript {
  id: string
  fromVersion: string
  toVersion: string
  title: string
  summary: string
  changes: string[]
  /** 迁移执行逻辑 */
  migrate: (ctx: MigrationContext) => Promise<MigrationStepResult>
}

export interface MigrationHistoryItem {
  scriptId: string
  fromVersion: string
  toVersion: string
  migratedAt: number
  success: boolean
  modifiedFiles: string[]
  details?: string
  error?: string
}

export interface SchemaMeta {
  schemaVersion: string
  updatedAt: number
  /** 是否开启应用启动时自动检测并执行数据迁移（默认开启） */
  autoMigrate?: boolean
  history: MigrationHistoryItem[]
}

export interface ChainPlan {
  currentVersion: string
  targetVersion: string
  scripts: MigrationScript[]
  isUpToDate: boolean
}
