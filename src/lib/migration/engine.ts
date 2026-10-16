/**
 * 链式数据迁移执行引擎。
 *
 * 负责：
 * 1. 分析当前版本与最新版本之间的升级路径，规划有向有序执行链；
 * 2. 构造隔离的迁移运行时上下文 (MigrationContext)；
 * 3. 逐步执行迁移脚本、自动备份与写入审计历史，确保每一步幂等安全。
 */

import {
  listDir,
  mkdir,
  readJson,
  readText,
  readYaml,
  removePath,
  userRel,
  writeJson,
  writeText,
  writeYaml,
} from '../storage'
import { MIGRATION_SCRIPTS } from './scripts'
import type {
  ChainPlan,
  MigrationContext,
  MigrationHistoryItem,
  MigrationScript,
  MigrationStepResult,
  SchemaMeta,
} from './types'
import {
  compareVersions,
  detectSchemaVersion,
  LATEST_SCHEMA_VERSION,
  saveSchemaMeta,
} from './version'

/** 规划迁移链条 */
export function planChain(
  fromVersion: string,
  toVersion: string = LATEST_SCHEMA_VERSION,
): ChainPlan {
  const cmp = compareVersions(fromVersion, toVersion)
  if (cmp >= 0) {
    return {
      currentVersion: fromVersion,
      targetVersion: toVersion,
      scripts: [],
      isUpToDate: true,
    }
  }

  // 按首尾相连寻找迁移路线
  const scripts: MigrationScript[] = []
  let cursor = fromVersion

  while (compareVersions(cursor, toVersion) < 0) {
    const nextScript = MIGRATION_SCRIPTS.find(
      (s) => s.fromVersion === cursor && compareVersions(s.toVersion, toVersion) <= 0,
    )
    if (!nextScript) {
      // 如果没有精确匹配起始版本的脚本，寻找第一个覆盖范围内的前瞻脚本
      const fallbackScript = MIGRATION_SCRIPTS.find(
        (s) => compareVersions(s.fromVersion, cursor) >= 0 && compareVersions(s.toVersion, toVersion) <= 0,
      )
      if (fallbackScript) {
        scripts.push(fallbackScript)
        cursor = fallbackScript.toVersion
        continue
      }
      break
    }
    scripts.push(nextScript)
    cursor = nextScript.toVersion
  }

  return {
    currentVersion: fromVersion,
    targetVersion: toVersion,
    scripts,
    isUpToDate: scripts.length === 0,
  }
}

/** 构造迁移上下文 */
export function createMigrationContext(
  uid: string,
  onLog: (msg: string) => void,
): MigrationContext {
  return {
    uid,
    userDir: userRel(uid),
    storage: {
      readJson: (rel: string) => readJson(rel),
      writeJson: (rel: string, data: unknown) => writeJson(rel, data),
      readYaml: (rel: string) => readYaml(rel),
      writeYaml: (rel: string, data: unknown) => writeYaml(rel, data),
      readText: (rel: string) => readText(rel),
      writeText: (rel: string, content: string) => writeText(rel, content),
      listDir: (rel: string) => listDir(rel),
      removePath: (rel: string) => removePath(rel),
      mkdir: (rel: string) => mkdir(rel),
    },
    log: (msg: string) => {
      const time = new Date().toLocaleTimeString()
      onLog(`[${time}] ${msg}`)
    },
  }
}

/** 执行单个迁移脚本 */
export async function runSingleScript(
  uid: string,
  script: MigrationScript,
  onLog: (msg: string) => void,
): Promise<MigrationStepResult> {
  const ctx = createMigrationContext(uid, onLog)
  ctx.log(`========== 开始执行迁移脚本：${script.title} (${script.fromVersion} -> ${script.toVersion}) ==========`)

  try {
    const res = await script.migrate(ctx)
    if (!res.ok) {
      ctx.log(`[错误] 迁移失败：${res.error || '未知原因'}`)
      return res
    }

    // 记录历史履历并推进 Schema 版本号
    const { meta: prevMeta } = await detectSchemaVersion(uid)
    const historyItem: MigrationHistoryItem = {
      scriptId: script.id,
      fromVersion: script.fromVersion,
      toVersion: script.toVersion,
      migratedAt: Date.now(),
      success: true,
      modifiedFiles: res.modifiedFiles,
      details: res.details,
    }

    const nextMeta: SchemaMeta = {
      schemaVersion: script.toVersion,
      updatedAt: Date.now(),
      history: [...(prevMeta?.history || []), historyItem],
    }

    await saveSchemaMeta(uid, nextMeta)
    ctx.log(`[完成] 成功迁移至版本 v${script.toVersion}，版本元数据已持久化。`)
    return res
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    ctx.log(`[异常] 迁移过程发生未捕获异常：${errorMsg}`)
    return {
      ok: false,
      fromVersion: script.fromVersion,
      toVersion: script.toVersion,
      modifiedFiles: [],
      error: errorMsg,
    }
  }
}

/** 执行完整链式迁移流程 */
export async function runChain(
  uid: string,
  scripts: MigrationScript[],
  onProgress?: (current: number, total: number, script: MigrationScript) => void,
  onLog?: (msg: string) => void,
): Promise<{ ok: boolean; executed: MigrationStepResult[]; error?: string }> {
  const logger = onLog || (() => {})
  logger(`>>> 启动链式数据迁移任务，共 ${scripts.length} 个阶段`)
  const executed: MigrationStepResult[] = []

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]
    if (onProgress) onProgress(i + 1, scripts.length, script)

    const res = await runSingleScript(uid, script, logger)
    executed.push(res)

    if (!res.ok) {
      const err = `链式迁移在第 ${i + 1} 步中断 (${script.fromVersion} -> ${script.toVersion}): ${res.error}`
      logger(`[中断] ${err}`)
      return { ok: false, executed, error: err }
    }
  }

  logger(`>>> 链式数据迁移顺利完成，全部 ${scripts.length} 个阶段均已成功执行！`)
  return { ok: true, executed }
}
