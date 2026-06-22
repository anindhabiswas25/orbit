import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Logger } from '../logger/Logger'

const log = new Logger('processed-events')

interface DiskCache {
  engine: string
  ids: number[]
}

/**
 * Tracks which jobIds have already been settled so the orchestrator never
 * pays twice.
 *
 * IMPORTANT: jobIds are only unique *per engine deployment*. When the
 * AgentSelectionEngine is redeployed it restarts its jobId counter at 1, so the
 * new engine's low jobIds collide with historical settlements from older
 * engines (both on disk and in the PaymentLedger). To avoid wrongly skipping
 * brand-new jobs, the processed set is scoped to the *current* engine address:
 * if the engine has changed since we last persisted, we start clean and do NOT
 * preload the ledger's historical (old-engine) jobIds.
 */
export class ProcessedEvents {
  private processed: Set<number> = new Set()
  private engine = ''
  private readonly diskPath = path.join(os.homedir(), '.orbit', 'orchestrator-processed.json')

  async initialize(ledger: any, engineAddress: string): Promise<void> {
    this.engine = engineAddress.toLowerCase()

    const disk = this.readDisk()
    const sameEngine = disk && disk.engine === this.engine

    if (sameEngine) {
      disk!.ids.forEach(id => this.processed.add(id))

      // Ledger history is only valid for the same engine — its jobIds share the
      // current engine's id space. Preload it as the authoritative record.
      try {
        const total = Number(await ledger.getTotalSettled())
        if (total > 0) {
          const batchSize = 50
          for (let i = 0; i < total; i += batchSize) {
            const ids = await ledger.getSettledJobIds(i, Math.min(batchSize, total - i))
            ids.forEach((id: bigint) => this.processed.add(Number(id)))
          }
        }
      } catch (err: any) {
        log.warn('Failed to load settled jobs from chain — using disk cache only', { error: err.message })
      }
    } else if (disk) {
      log.warn(
        `Engine changed (${disk.engine} → ${this.engine}) — starting with a clean ` +
          `processed set (ignoring old-engine jobIds to avoid id collisions).`
      )
    }

    this.persist()
    log.info(`Loaded ${this.processed.size} settled jobs for engine ${this.engine}`)
  }

  has(jobId: number): boolean { return this.processed.has(jobId) }
  mark(jobId: number): void { this.processed.add(jobId); this.persist() }
  count(): number { return this.processed.size }

  private readDisk(): DiskCache | null {
    if (!fs.existsSync(this.diskPath)) return null
    try {
      const raw = JSON.parse(fs.readFileSync(this.diskPath, 'utf8'))
      // Legacy format was a bare number[] with no engine context — treat as
      // "unknown engine" so it does not falsely match the current engine.
      if (Array.isArray(raw)) return { engine: '', ids: raw }
      if (raw && typeof raw === 'object' && Array.isArray(raw.ids)) {
        return { engine: String(raw.engine || '').toLowerCase(), ids: raw.ids }
      }
    } catch {
      log.warn('Failed to parse disk cache — starting fresh')
    }
    return null
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.diskPath), { recursive: true })
      const data: DiskCache = { engine: this.engine, ids: [...this.processed] }
      fs.writeFileSync(this.diskPath, JSON.stringify(data))
    } catch (err: any) {
      log.warn('Failed to persist to disk', { error: err.message })
    }
  }
}
