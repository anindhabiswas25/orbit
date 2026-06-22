import { Command } from 'commander'
import { CredentialManager, ChainClient } from '@orbit/core'
import { inlineLogo, info, fail, C } from '../ui/brand'
import { askPassword } from '../ui/prompt'
import { Spinner } from '../ui/spinner'

const cmd = new Command('earnings')
cmd.description('Show USDC earnings estimate for an agent')
cmd.option('-a, --agent <name>', 'Agent profile name')

cmd.action(async (opts) => {
  try {
    const agentName = opts.agent || CredentialManager.getDefault()
    console.log('\n  ' + inlineLogo() + C.muted('  Earnings: ' + agentName) + '\n')

    const password = await askPassword(`Unlock "${agentName}"`)
    const profile = CredentialManager.loadProfile(agentName, password)
    const client = new ChainClient(profile.encryptedKey, profile.rpcUrl)

    const spinner = new Spinner('Loading job history from chain...').start()
    const [agentRaw, vaultBal] = await Promise.all([
      client.contracts.registry.getAgent(profile.wallet),
      client.contracts.vault.getVaultBalance().catch(() => 0n),
    ])
    const jobsDone = Number(agentRaw.jobsCompleted)
    const fee = Number(agentRaw.fee)
    const perJob = (Number(vaultBal) / 1e6) * (fee / 10000)
    const totalEst = perJob * jobsDone
    spinner.succeed('Loaded')

    console.log('\n  ' + C.bold(C.primary('EARNINGS ESTIMATE')))
    console.log(C.muted('  (Estimates based on on-chain job count × current fee rate)\n'))
    info(`Jobs completed:  ${C.accent(String(jobsDone))}`)
    info(`Fee rate:        ${(fee / 100).toFixed(2)}% per job`)
    info(`Est. per job:    ${C.success(perJob.toFixed(6) + ' USDC')}`)
    info(`Est. total:      ${C.success(totalEst.toFixed(4) + ' USDC')}`)
    console.log('')
    console.log(C.muted('  For exact earnings, check FeePool.AgentPaid events on SnowTrace.'))
    console.log('')
  } catch (err: any) {
    fail(err.message)
    process.exit(1)
  }
})

export default cmd
