import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import {
  CredentialManager,
  ChainClient,
  AgentRunner,
  type AgentRunCallbacks,
} from '@orbit/core'
import { printLogo, fail, C } from '../ui/brand'
import { askPassword } from '../ui/prompt'
import { Dashboard } from '../ui/dashboard/Dashboard'
import { ReceiptServer } from '../agent-server/ReceiptServer'
import type { ReceiptReceivedEvent } from '../agent-server/types'

const cmd = new Command('run')
cmd.description('Start agent with live dashboard (runs until you press q)')
cmd.option('-a, --agent <name>', 'Agent profile name (defaults to default agent)')
cmd.option('--no-dashboard', 'Run without dashboard (plain log output)')

cmd.action(async (opts) => {
  try {
    const agentName = opts.agent || CredentialManager.getDefault()

    printLogo('Live Agent Runner')
    console.log(`  ${C.accent('Starting agent:')} ${C.bold(agentName)}\n`)

    const password = await askPassword(`Unlock "${agentName}"`)
    const profile = CredentialManager.loadProfile(agentName, password)
    const client = new ChainClient(profile.encryptedKey, profile.rpcUrl)

    CredentialManager.ensureDirectories()
    const logFile = path.join(CredentialManager.logDir, `${agentName}.log`)
    const logStream = fs.createWriteStream(logFile, { flags: 'a' })

    const dashboard = opts.dashboard !== false ? new Dashboard(agentName, profile.type, profile.wallet) : null
    const runner = new AgentRunner(client, profile.type)

    const callbacks: AgentRunCallbacks = {
      onJobAssigned: (ev) => {
        dashboard?.jobFeed.addJob({
          jobId: ev.jobId,
          type: ev.type,
          status: 'Pending',
          assignedAt: new Date(),
          deadline: ev.deadline,
        })
        dashboard?.render()
      },
      onJobCompleted: (ev) => {
        dashboard?.jobFeed.updateJob(ev.jobId, 'Completed', ev.elapsedMs)
        dashboard?.earnings.addPayment(ev.payment)
        dashboard?.render()
      },
      onJobExpired: (ev) => {
        dashboard?.jobFeed.updateJob(ev.jobId, 'Expired')
        dashboard?.render()
      },
      onRebalance: (ev) => {
        dashboard?.leaderboard.setActive(ev.toProtocol, ev.toAPY)
        dashboard?.render()
      },
      onReputation: (ev) => {
        dashboard?.header.setReputation(ev.newScore)
        dashboard?.render()
      },
      onError: (ev) => {
        const msg = `[ERROR] Job #${ev.jobId ?? '?'}: ${ev.error.message}`
        dashboard?.log.append(msg)
        logStream.write(new Date().toISOString() + ' ERROR ' + msg + '\n')
        if (!dashboard) process.stdout.write(msg + '\n')
        dashboard?.render()
      },
      onLog: (msg) => {
        dashboard?.log.append(msg)
        logStream.write(new Date().toISOString() + ' ' + msg + '\n')
        if (!dashboard) process.stdout.write(msg + '\n')
        else dashboard.render()
      },
    }

    let leaderboardTimer: NodeJS.Timeout | undefined
    let reputationTimer: NodeJS.Timeout | undefined
    let agentRankTimer: NodeJS.Timeout | undefined

    // Start x402 receipt server
    const orchestratorWallet = process.env.ORCHESTRATOR_WALLET ?? ''
    const receiptServer = orchestratorWallet ? new ReceiptServer(orchestratorWallet) : null
    if (receiptServer) {
      receiptServer.start(4001)
      receiptServer.on('receipt', (ev: ReceiptReceivedEvent) => {
        dashboard?.jobFeed.markSettled(ev.jobId, ev.amount)
        dashboard?.log.append(
          `[${ev.timestamp.toLocaleTimeString()}] ` +
          `✓ Payment settled +${ev.amount} USDC · Job #${ev.jobId} · ` +
          `tx: ${ev.settlementTx.slice(0, 12)}...`
        )
        dashboard?.earnings.addPayment(parseFloat(ev.amount))
        dashboard?.render()
      })
    }

    if (dashboard) {
      await dashboard.start(async () => {
        await runner.start(callbacks)
        leaderboardTimer = startLeaderboardPolling(client, dashboard)
        reputationTimer = startReputationPolling(client, profile.wallet, dashboard)
        agentRankTimer = startAgentRankPolling(client, profile.wallet, dashboard)
      })

      dashboard.onKey('q', () => {
        runner.stop()
        receiptServer?.stop()
        if (leaderboardTimer) clearInterval(leaderboardTimer)
        if (reputationTimer) clearInterval(reputationTimer)
        if (agentRankTimer) clearInterval(agentRankTimer)
        dashboard.destroy()
        logStream.end()
        process.exit(0)
      })
      dashboard.onKey('p', () => {
        if (runner.currentState === 'running') {
          runner.pause()
          dashboard.header.setStatus('PAUSED')
        } else {
          runner.resume()
          dashboard.header.setStatus('ACTIVE')
        }
        dashboard.render()
      })
    } else {
      await runner.start(callbacks)
      process.on('SIGINT', () => {
        runner.stop()
        receiptServer?.stop()
        logStream.end()
        process.exit(0)
      })
      await new Promise<void>(() => {
        /* keep process alive */
      })
    }
  } catch (err: any) {
    fail(err.message)
    process.exit(1)
  }
})

function startLeaderboardPolling(client: ChainClient, dashboard: Dashboard): NodeJS.Timeout {
  const poll = async () => {
    try {
      const adapters = [
        { name: 'AAVE V3', contract: client.contracts.adapters.aave },
        { name: 'Benqi', contract: client.contracts.adapters.benqi },
        { name: 'MockPoolA', contract: client.contracts.adapters.mockA },
        { name: 'MockPoolB', contract: client.contracts.adapters.mockB },
      ]
      const results = await Promise.all(
        adapters.map(async (a) => ({
          name: a.name,
          apy: Number(await a.contract.getAPY().catch(() => 0)),
        }))
      )
      dashboard.leaderboard.setProtocols(results)
      dashboard.render()
    } catch {
      /* non-fatal */
    }
  }
  void poll()
  return setInterval(poll, 15_000)
}

function startReputationPolling(
  client: ChainClient,
  wallet: string,
  dashboard: Dashboard
): NodeJS.Timeout {
  const poll = async () => {
    try {
      const agent = await client.contracts.registry.getAgent(wallet)
      dashboard.header.setReputation(Number(agent.reputationScore))
      dashboard.header.setStatus(Number(agent.status) === 0 ? 'ACTIVE' : 'PAUSED')
      dashboard.render()
    } catch {
      /* non-fatal */
    }
  }
  void poll()
  return setInterval(poll, 30_000)
}

function startAgentRankPolling(
  client: ChainClient,
  myWallet: string,
  dashboard: Dashboard
): NodeJS.Timeout {
  const typeLabel = ['Scout', 'Executor'] as const
  const poll = async () => {
    try {
      const [scoutAddrs, execAddrs] = await Promise.all([
        client.contracts.registry.getAllScouts(),
        client.contracts.registry.getAllExecutors(),
      ])
      const allAddrs = [...scoutAddrs, ...execAddrs]
      const entries = await Promise.all(
        allAddrs.map(async (addr: string) => {
          const a = await client.contracts.registry.getAgent(addr)
          const short = addr.slice(0, 6) + '…' + addr.slice(-4)
          return {
            name: short,
            type: typeLabel[Number(a.agentType)] ?? '?',
            reputation: Number(a.reputationScore),
            jobs: Number(a.jobsCompleted),
            isMe: addr.toLowerCase() === myWallet.toLowerCase(),
          }
        })
      )
      dashboard.agentRank.setAgents(entries)
      dashboard.render()
    } catch {
      /* non-fatal */
    }
  }
  void poll()
  return setInterval(poll, 15_000)
}

export default cmd
