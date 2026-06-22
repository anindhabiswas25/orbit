import { Command } from 'commander'
import {
  CredentialManager,
  ChainClient,
  Registrar,
  FUJI_EXPLORER,
  ChainError,
} from '@orbit/core'
import { ok, warn, fail, errorBox, C } from '../ui/brand'
import { askPassword, askConfirm } from '../ui/prompt'
import { txProgress } from '../ui/progress'

const cmd = new Command('deregister')
cmd.description('Deregister agent on-chain and reclaim stake (if reputation >= 0)')
cmd.option('-a, --agent <name>', 'Agent profile name')

cmd.action(async (opts) => {
  try {
    const agentName = opts.agent || CredentialManager.getDefault()

    console.log(`\n  ${C.warning('⚠')} Deregistering "${agentName}"`)
    console.log(C.muted('  Stake returned if reputation >= 0. Wallet can re-register later.\n'))

    const confirmed = await askConfirm(`Confirm deregister "${agentName}"?`)
    if (!confirmed) {
      console.log(C.muted('  Cancelled.'))
      return
    }

    const password = await askPassword(`Unlock "${agentName}"`)
    const profile = CredentialManager.loadProfile(agentName, password)
    const client = new ChainClient(profile.encryptedKey, profile.rpcUrl)

    let txHash = ''
    await txProgress(
      `Deregistering "${agentName}"...`,
      Registrar.deregister(client, (step, hash) => {
        if (step === 'done') txHash = hash || ''
      })
    )
    ok(`Deregistered · ${FUJI_EXPLORER}/tx/${txHash}`)

    const agent = await client.contracts.registry.getAgent(profile.wallet)
    if (Number(agent.reputationScore) >= 0) {
      ok('5.00 USDC stake returned to wallet')
    } else {
      warn('Reputation was negative — stake was not returned (protocol rule)')
    }

    CredentialManager.removeProfile(agentName)
    ok(`Profile "${agentName}" removed from credential file`)
    console.log('')
  } catch (err: any) {
    if (err instanceof ChainError) {
      errorBox('Deregistration failed', [err.message, err.txHash ? `tx: ${err.txHash}` : ''])
    } else {
      fail(err.message)
    }
    process.exit(1)
  }
})

export default cmd
