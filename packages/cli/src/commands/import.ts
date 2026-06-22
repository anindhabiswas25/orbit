import { Command } from 'commander'
import { ethers } from 'ethers'
import {
  ChainClient,
  Registrar,
  CredentialManager,
  syncAgentToEnv,
  UserError,
  ChainError,
  type AgentProfile,
} from '@orbit/core'
import { printLogo, ok, warn, fail, successBox, errorBox, stepHeader, C } from '../ui/brand'
import { askText, askPassword, validatePrivateKey, validateProfileName } from '../ui/prompt'
import { Spinner } from '../ui/spinner'

const cmd = new Command('import')
cmd.description('Import an existing registered agent into your credential file')

cmd.action(async () => {
  printLogo()
  console.log('  ' + C.accent('⬡ Import Existing Agent') + '\n')

  try {
    stepHeader(1, 3, 'Agent Identity')
    const name = await askText('Agent profile name', validateProfileName)
    if (CredentialManager.listNames().includes(name)) {
      throw new UserError(`Profile "${name}" already exists`)
    }

    stepHeader(2, 3, 'Wallet Verification')
    const privateKey = await askText('Private key', (v) => validatePrivateKey(v))
    const wallet = new ethers.Wallet(privateKey)
    console.log(C.muted(`\n  Derived: ${wallet.address}\n`))

    const spinner = new Spinner('Verifying registration on Fuji...').start()
    const client = new ChainClient(privateKey)
    const info = await Registrar.verifyExisting(client)
    spinner.succeed('Wallet verified')

    ok(`Wallet:     ${info.wallet}`)
    ok(`Type:       ${info.type}`)
    ok(`Reputation: ${info.reputation >= 0 ? '+' : ''}${info.reputation}`)
    ok(`Status:     ${info.status}`)
    ok(`Stake:      ${info.stake.toFixed(2)} USDC locked`)

    stepHeader(3, 3, 'Secure Storage')
    const password = await askPassword('Credential password (for this machine)')
    if (password.length < 8) throw new UserError('Password must be at least 8 characters')
    const password2 = await askPassword('Confirm password')
    if (password !== password2) throw new UserError('Passwords do not match')

    const profile: AgentProfile = {
      name,
      type: info.type,
      wallet: wallet.address,
      encryptedKey: privateKey,
      developerWallet: wallet.address, // update manually in credentials.json if different
      endpoint: 'unknown',
      fee: 0,
      network: 'fuji',
      registeredAt: new Date().toISOString(),
      registrationTx: 'imported',
    }
    CredentialManager.saveProfile(profile, password)

    // Mirror the key into the repo .env for the process runner (run-4-agents.js).
    try {
      const env = syncAgentToEnv({
        type: info.type,
        wallet: wallet.address,
        privateKey,
        developerWallet: wallet.address,
      })
      ok(`Wrote ${env.slotName}_PRIVATE_KEY to ${env.path}`)
    } catch (e: any) {
      warn(`Could not update .env automatically: ${e.message}`)
    }

    successBox(`Agent "${name}" imported!`, [`  Run: ${C.primary('orbit run --agent ' + name)}`])
  } catch (err: any) {
    if (err instanceof UserError) {
      fail(err.message)
    } else if (err instanceof ChainError) {
      errorBox('Import failed', [err.message])
    } else {
      errorBox('Import failed', [err.message])
      if (process.env.DEBUG?.includes('orbit')) console.error(err.stack)
    }
    process.exit(1)
  }
})

export default cmd
