/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AgentType } from '@orbit/core'

// blessed is an optional dependency loaded lazily so the rest of the CLI works
// even when it is not installed. It has no first-class TS types we depend on, so
// widgets are typed as `any` here — this is internal terminal UI, not public API.
function loadBlessed(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('blessed')
  } catch {
    throw new Error(
      'The live dashboard requires the "blessed" package.\n' +
        'Install it with:  npm install -g blessed\n' +
        'Or run headless:  orbit run --no-dashboard'
    )
  }
}

interface JobEntry {
  jobId: number
  type: string
  status: 'Pending' | 'Completed' | 'Expired' | 'Failed' | 'Settled'
  assignedAt: Date
  deadline?: Date
  elapsedMs?: number
  payment?: string
}

interface ProtocolRow {
  name: string
  apy: number
  isActive: boolean
}

class HeaderPanel {
  private box: any
  private reputation = 0
  private status = 'ACTIVE'
  constructor(
    private blessed: any,
    screen: any,
    private agentName: string,
    private agentType: AgentType,
    private wallet: string
  ) {
    this.box = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: '#7C3AED' } },
      padding: { left: 1 },
      tags: true,
    })
    this.render()
  }
  setReputation(rep: number): void {
    this.reputation = rep
    this.render()
  }
  setStatus(status: string): void {
    this.status = status
    this.render()
  }
  private render(): void {
    const repColor =
      this.reputation > 5
        ? '{green-fg}'
        : this.reputation > 0
          ? '{yellow-fg}'
          : this.reputation === 0
            ? '{white-fg}'
            : '{red-fg}'
    const repSign = this.reputation >= 0 ? '+' : ''
    const statusColor = this.status === 'ACTIVE' ? '{green-fg}' : '{yellow-fg}'
    const walletShort = this.wallet.slice(0, 12) + '…' + this.wallet.slice(-6)
    const typeLabel = this.agentType === 'scout' ? 'Scout' : 'Executor'
    this.box.setContent(
      `{bold}⬡ ORBIT{/bold}  Agent: {bold}${this.agentName}{/bold} (${typeLabel})` +
        `{|}Fuji Testnet {green-fg}● live{/}\n` +
        `Wallet: {#06B6D4-fg}${walletShort}{/}    ` +
        `Reputation: ${repColor}${repSign}${this.reputation}{/}    ` +
        `Status: ${statusColor}${this.status}{/}`
    )
  }
}

class JobFeedPanel {
  private box: any
  private jobs: JobEntry[] = []
  constructor(blessed: any, screen: any) {
    this.box = blessed.box({
      parent: screen,
      top: 3,
      left: 0,
      width: '50%',
      height: '72%-3',
      label: ' LIVE JOB FEED ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: '#7C3AED' }, label: { fg: '#7C3AED' } },
      tags: true,
      padding: { left: 1 },
      scrollable: true,
      alwaysScroll: true,
    })
  }
  addJob(job: JobEntry): void {
    this.jobs.unshift(job)
    if (this.jobs.length > 50) this.jobs.pop()
    this.render()
  }
  updateJob(jobId: number, status: JobEntry['status'], elapsedMs?: number): void {
    const job = this.jobs.find((j) => j.jobId === jobId)
    if (job) {
      job.status = status
      if (elapsedMs !== undefined) job.elapsedMs = elapsedMs
    }
    this.render()
  }
  markSettled(jobId: number, amount: string): void {
    const job = this.jobs.find((j) => j.jobId === jobId)
    if (job) {
      job.status = 'Settled'
      job.payment = amount
    }
    this.render()
  }
  toggle(visible: boolean): void {
    visible ? this.box.show() : this.box.hide()
  }
  private render(): void {
    const ICON: Record<JobEntry['status'], string> = {
      Pending: '{yellow-fg}⏳{/}',
      Completed: '{cyan-fg}⚙{/}',
      Settled: '{green-fg}✓{/}',
      Expired: '{gray-fg}⌛{/}',
      Failed: '{red-fg}✗{/}',
    }
    const lines = this.jobs.slice(0, 20).map((j) => {
      const elapsed = j.elapsedMs ? ` ${(j.elapsedMs / 1000).toFixed(1)}s` : ''
      const paymentStr = j.status === 'Settled' && j.payment
        ? ` {green-fg}+${j.payment} USDC{/}`
        : ''
      return ` ${ICON[j.status]} #{bold}${j.jobId}{/bold} ${j.type.padEnd(8)}${elapsed}${paymentStr}`
    })
    this.box.setContent(lines.join('\n'))
  }
}

class LeaderboardPanel {
  private box: any
  private rows: ProtocolRow[] = []
  constructor(blessed: any, screen: any) {
    this.box = blessed.box({
      parent: screen,
      top: 3,
      left: '50%',
      width: '50%',
      height: '40%',
      label: ' APY LEADERBOARD ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: '#2563EB' }, label: { fg: '#2563EB' } },
      tags: true,
      padding: { left: 1 },
    })
  }
  setProtocols(rows: { name: string; apy: number }[], activeAddrName?: string): void {
    this.rows = rows
      .map((r) => ({ ...r, isActive: false }))
      .sort((a, b) => b.apy - a.apy)
    if (activeAddrName) this.setActiveByName(activeAddrName)
    this.render()
  }
  private setActiveByName(name: string): void {
    this.rows.forEach((r) => (r.isActive = r.name === name))
  }
  setActive(_protocol: string, _apy: number): void {
    // Active marker is refreshed by the leaderboard poller; no-op placeholder for
    // the rebalance event hook.
    this.render()
  }
  toggle(visible: boolean): void {
    visible ? this.box.show() : this.box.hide()
  }
  private render(): void {
    const header = ' {gray-fg}#  Protocol      APY      Status{/}'
    const lines = this.rows.map((r, i) => {
      const apy = `${(r.apy / 100).toFixed(2)}%`
      const active = r.isActive ? '{green-fg}● ACTIVE{/}' : ''
      return ` ${i + 1}  ${r.name.padEnd(12)} ${apy.padEnd(8)} ${active}`
    })
    this.box.setContent([header, '', ...lines].join('\n'))
  }
}

class EarningsPanel {
  private box: any
  private total = 0
  private jobCount = 0
  private agentType: AgentType
  constructor(blessed: any, screen: any, agentType: AgentType) {
    this.agentType = agentType
    this.box = blessed.box({
      parent: screen,
      top: '43%',
      left: '50%',
      width: '50%',
      height: '15%',
      label: ' EARNINGS ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: '#06B6D4' }, label: { fg: '#06B6D4' } },
      tags: true,
      padding: { left: 1 },
    })
    this.render()
  }
  addPayment(amount: number): void {
    this.total += amount
    this.jobCount += 1
    this.render()
  }
  toggle(visible: boolean): void {
    visible ? this.box.show() : this.box.hide()
  }
  private render(): void {
    const perJob = this.jobCount > 0 ? this.total / this.jobCount : 0
    const stakeStr = this.agentType === 'executor' ? '5.00 USDC locked' : 'None (free)'
    this.box.setContent(
      ` Total: {green-fg}${this.total.toFixed(4)} USDC{/}  Jobs: ${this.jobCount}` +
        `  Avg: ~${perJob.toFixed(4)}  Stake: ${stakeStr}`
    )
  }
}

interface AgentRankEntry {
  name: string
  type: string
  reputation: number
  jobs: number
  isMe: boolean
}

class AgentRankPanel {
  private box: any
  private agents: AgentRankEntry[] = []
  constructor(blessed: any, screen: any) {
    this.box = blessed.box({
      parent: screen,
      top: '58%',
      left: '50%',
      width: '50%',
      height: '14%',
      label: ' ALL AGENTS — REPUTATION ',
      border: { type: 'line' },
      style: { fg: 'white', border: { fg: '#F59E0B' }, label: { fg: '#F59E0B' } },
      tags: true,
      padding: { left: 1 },
      scrollable: true,
      alwaysScroll: true,
    })
  }
  setAgents(agents: AgentRankEntry[]): void {
    this.agents = agents.sort((a, b) => b.reputation - a.reputation)
    this.render()
  }
  toggle(visible: boolean): void {
    visible ? this.box.show() : this.box.hide()
  }
  private render(): void {
    const header = ' {gray-fg}#  Agent         Type      Rep   Jobs{/}'
    const lines = this.agents.map((a, i) => {
      const repColor = a.reputation > 0 ? '{green-fg}' : a.reputation < 0 ? '{red-fg}' : '{white-fg}'
      const sign = a.reputation >= 0 ? '+' : ''
      const me = a.isMe ? ' {cyan-fg}◄ YOU{/}' : ''
      const walletShort = a.name.length > 12 ? a.name.slice(0, 12) + '…' : a.name.padEnd(13)
      return ` ${i + 1}  ${walletShort} ${a.type.padEnd(9)} ${repColor}${sign}${a.reputation}{/}`.padEnd(44) + `${a.jobs}${me}`
    })
    this.box.setContent([header, ...lines].join('\n'))
  }
}

class LogPanel {
  private logBox: any
  constructor(blessed: any, screen: any) {
    this.logBox = blessed.log({
      parent: screen,
      top: '72%',
      left: 0,
      width: '100%',
      height: '25%',
      label: ' LOG ',
      border: { type: 'line' },
      style: { fg: '#9CA3AF', border: { fg: '#374151' }, label: { fg: '#6B7280' } },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { style: { bg: '#7C3AED' } },
      padding: { left: 1 },
    })
  }
  append(msg: string): void {
    this.logBox.log(msg)
  }
}

/**
 * Dashboard — blessed-based terminal UI controller.
 *
 * blessed renders to the alternate screen buffer; stdout.write() will not appear
 * while the dashboard is active, so all output goes through dashboard.log.append().
 */
export class Dashboard {
  public header: HeaderPanel
  public jobFeed: JobFeedPanel
  public leaderboard: LeaderboardPanel
  public earnings: EarningsPanel
  public agentRank: AgentRankPanel
  public log: LogPanel

  private screen: any
  private logOnly = false
  private keyHandlers = new Map<string, () => void>()

  constructor(agentName: string, agentType: AgentType, wallet: string) {
    const blessed = loadBlessed()
    this.screen = blessed.screen({
      smartCSR: true,
      title: `Orbit — ${agentName}`,
      dockBorders: true,
      fullUnicode: true,
    })

    this.header = new HeaderPanel(blessed, this.screen, agentName, agentType, wallet)
    this.jobFeed = new JobFeedPanel(blessed, this.screen)
    this.leaderboard = new LeaderboardPanel(blessed, this.screen)
    this.earnings = new EarningsPanel(blessed, this.screen, agentType)
    this.agentRank = new AgentRankPanel(blessed, this.screen)
    this.log = new LogPanel(blessed, this.screen)

    this.attachKeyBindings()
    this.renderKeyBar(blessed)
  }

  private renderKeyBar(blessed: any): void {
    blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'gray' },
      content: ' q quit  ·  p pause/resume  ·  l logs only  ·  r refresh',
    })
  }

  async start(onReady: () => Promise<void>): Promise<void> {
    this.screen.render()
    await onReady()
    await new Promise<void>((resolve) => this.screen.on('destroy', resolve))
  }

  render(): void {
    this.screen.render()
  }

  destroy(): void {
    this.screen.destroy()
  }

  onKey(key: string, handler: () => void): void {
    this.keyHandlers.set(key, handler)
  }

  toggleLogsOnly(): void {
    this.logOnly = !this.logOnly
    this.jobFeed.toggle(!this.logOnly)
    this.leaderboard.toggle(!this.logOnly)
    this.earnings.toggle(!this.logOnly)
    this.agentRank.toggle(!this.logOnly)
    this.screen.render()
  }

  private attachKeyBindings(): void {
    this.screen.key(['q', 'C-c'], () => this.keyHandlers.get('q')?.())
    this.screen.key(['p'], () => this.keyHandlers.get('p')?.())
    this.screen.key(['l'], () => {
      this.toggleLogsOnly()
      this.keyHandlers.get('l')?.()
    })
    this.screen.key(['r'], () => {
      this.screen.render()
      this.keyHandlers.get('r')?.()
    })
  }
}
