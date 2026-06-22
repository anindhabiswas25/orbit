import { Command } from 'commander'
import { CredentialManager, ChainClient, ADAPTER_NAMES } from '@orbit/core'
import { inlineLogo, info, fail, C } from '../ui/brand'
import { askPassword } from '../ui/prompt'
import { Spinner } from '../ui/spinner'

const cmd = new Command('status')
cmd.description('One-time snapshot of agent status and protocol state')
cmd.option('-a, --agent <name>', 'Agent profile name (defaults to default agent)')

cmd.action(async (opts) => {
  try {
    const agentName = opts.agent || CredentialManager.getDefault()
    console.log('\n  ' + inlineLogo() + C.muted('  Status: ' + agentName) + '\n')

    const password = await askPassword(`Unlock "${agentName}"`)
    const profile = CredentialManager.loadProfile(agentName, password)
    const client = new ChainClient(profile.encryptedKey, profile.rpcUrl)

    const spinner = new Spinner('Reading from Fuji...').start()
    const [agentRaw, vaultBal, active, activeAPY, best, bestAPY] = await Promise.all([
      client.contracts.registry.getAgent(profile.wallet),
      client.contracts.vault.getVaultBalance().catch(() => 0n),
      client.contracts.yieldReg.activeProtocol(),
      client.contracts.yieldReg.activeAPY(),
      client.contracts.yieldReg.bestProtocol(),
      client.contracts.yieldReg.bestAPY(),
    ])
    spinner.succeed('Data loaded')

    const STATUS_MAP: Record<number, string> = {
      0: 'Active',
      1: 'Paused',
      2: 'Deregistered',
      3: 'Banned',
    }
    const rep = Number(agentRaw.reputationScore)
    const status = STATUS_MAP[Number(agentRaw.status)] ?? 'Unknown'

    console.log('\n  ' + C.bold(C.primary('AGENT')))
    info(`Name:        ${agentName}`)
    info(`Wallet:      ${profile.wallet}`)
    info(`Type:        ${profile.type}`)
    info(`Status:      ${status === 'Active' ? C.success(status) : C.warning(status)}`)
    info(`Reputation:  ${rep >= 0 ? C.success('+' + rep) : C.error(String(rep))}`)
    info(`Jobs done:   ${Number(agentRaw.jobsCompleted)}`)
    info(`Jobs failed: ${Number(agentRaw.jobsFailed)}`)
    info(`Stake:       ${(Number(agentRaw.stake) / 1e6).toFixed(2)} USDC locked`)

    console.log('\n  ' + C.bold(C.primary('VAULT')))
    info(`Balance:         ${(Number(vaultBal) / 1e6).toFixed(2)} USDC`)
    info(
      `Active protocol: ${ADAPTER_NAMES[(active as string)?.toLowerCase()] ?? 'None'} @ ${(
        Number(activeAPY) / 100
      ).toFixed(2)}%`
    )
    info(
      `Best available:  ${ADAPTER_NAMES[(best as string)?.toLowerCase()] ?? 'None'} @ ${(
        Number(bestAPY) / 100
      ).toFixed(2)}%`
    )
    console.log('')
  } catch (err: any) {
    fail(err.message)
    process.exit(1)
  }
})

export default cmd
