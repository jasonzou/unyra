import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/lib/migration/version'
import { planChain } from '../src/lib/migration/engine'
import { registerMigrationScript, MIGRATION_SCRIPTS } from '../src/lib/migration/scripts'
import type { MigrationContext, MigrationScript } from '../src/lib/migration/types'

describe('Migration System', () => {
  describe('compareVersions', () => {
    it('correctly compares version numbers', () => {
      expect(compareVersions('0.6.3', '0.7.0')).toBe(-1)
      expect(compareVersions('0.7.0', '0.6.3')).toBe(1)
      expect(compareVersions('0.6.3', '0.6.3')).toBe(0)
      expect(compareVersions('0.7.0', '0.7.1')).toBe(-1)
      expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    })
  })

  describe('planChain', () => {
    it('returns empty chain when already at target version', () => {
      const plan = planChain('0.6.3', '0.6.3')
      expect(plan.isUpToDate).toBe(true)
      expect(plan.scripts.length).toBe(0)
    })

    it('plans chain when future scripts are registered', () => {
      const mockScript1: MigrationScript = {
        id: 'm_test_0_6_3_to_0_7_0',
        fromVersion: '0.6.3',
        toVersion: '0.7.0',
        title: 'Upgrade to 0.7.0',
        summary: 'Test script 1',
        changes: ['Update field A'],
        migrate: async () => ({ ok: true, fromVersion: '0.6.3', toVersion: '0.7.0', modifiedFiles: [] }),
      }

      const mockScript2: MigrationScript = {
        id: 'm_test_0_7_0_to_0_8_0',
        fromVersion: '0.7.0',
        toVersion: '0.8.0',
        title: 'Upgrade to 0.8.0',
        summary: 'Test script 2',
        changes: ['Update field B'],
        migrate: async () => ({ ok: true, fromVersion: '0.7.0', toVersion: '0.8.0', modifiedFiles: [] }),
      }

      registerMigrationScript(mockScript1)
      registerMigrationScript(mockScript2)

      const plan = planChain('0.6.3', '0.8.0')
      expect(plan.isUpToDate).toBe(false)
      expect(plan.scripts.length).toBe(2)
      expect(plan.scripts[0].id).toBe('m_test_0_6_3_to_0_7_0')
      expect(plan.scripts[1].id).toBe('m_test_0_7_0_to_0_8_0')

      // Clean up test scripts
      const idx1 = MIGRATION_SCRIPTS.findIndex((s) => s.id === mockScript1.id)
      if (idx1 >= 0) MIGRATION_SCRIPTS.splice(idx1, 1)
      const idx2 = MIGRATION_SCRIPTS.findIndex((s) => s.id === mockScript2.id)
      if (idx2 >= 0) MIGRATION_SCRIPTS.splice(idx2, 1)
    })
  })

  describe('Script Execution', () => {
    it('executes a migration script and transforms data', async () => {
      const store: Record<string, unknown> = {
        'users/test/state.json': {
          dataVersion: 'old',
        },
      }

      const logs: string[] = []
      const ctx: MigrationContext = {
        uid: 'test',
        userDir: 'users/test',
        storage: {
          readJson: async <T>(rel: string) => (store[rel] as T) ?? null,
          writeJson: async (rel: string, data: unknown) => {
            store[rel] = data
            return true
          },
          readYaml: async () => null,
          writeYaml: async () => true,
          readText: async () => null,
          writeText: async () => true,
          listDir: async () => [],
          removePath: async () => true,
          mkdir: async () => true,
        },
        log: (msg) => logs.push(msg),
      }

      const testScript: MigrationScript = {
        id: 'test_upgrade',
        fromVersion: '0.6.3',
        toVersion: '0.7.0',
        title: 'Test Upgrade',
        summary: 'Test data migration',
        changes: ['Update dataVersion to new'],
        migrate: async (context) => {
          const state = await context.storage.readJson<Record<string, unknown>>('users/test/state.json')
          if (state) {
            state.dataVersion = 'new'
            await context.storage.writeJson('users/test/state.json', state)
          }
          return {
            ok: true,
            fromVersion: '0.6.3',
            toVersion: '0.7.0',
            modifiedFiles: ['users/test/state.json'],
          }
        },
      }

      const res = await testScript.migrate(ctx)
      expect(res.ok).toBe(true)
      expect((store['users/test/state.json'] as any).dataVersion).toBe('new')
    })
  })
})
