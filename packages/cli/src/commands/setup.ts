import { Command } from 'commander'
import { ethers } from 'ethers'
import {
  ChainClient,
  PreflightCheck,
  Registrar,
  CredentialManager,
  syncAgentToEnv,
  readEnvValue,
  FUJI_EXPLORER,
  UserError,
  ChainError,
  type AgentProfile,
  type AgentType,
} from '@orbit/core'
import {
  printLogo,
  stepHeader,
  ok,
  warn,
  fail,
  successBox,
  errorBox,
  C,
} from '../ui/brand'
import {
  askText,
  askPassword,
  askSelect,
  validatePrivateKey,
  validateAddress,
  validateURL,
  validateFee,
  validateProfileName,
} from '../ui/prompt'
import { Spinner } from '../ui/spinner'

const cmd = new Command('setup')
cmd.description('Register a new agent (interactive wizard)')

cmd.action(async () => {
  printLogo('Agent Setup Wizard')
  console.log('  ' + C.accent('⚡ This wizard will'))
  console.log('  ' + C.muted('   1. Verify your wallet & balances on Fuji'))
  console.log('  ' + C.muted('   2. Encrypt your signing key locally (AES-256)'))
  console.log('  ' + C.muted('   3. Register your agent on-chain and start jobs') + '\n')

  try {
    // ── Step 1: Profile name ──────────────────────────────────────────────
    stepHeader(1, 6, 'Agent Identity')
    const name = await askText('Agent profile name', validateProfileName)
    if (CredentialManager.listNames().includes(name)) {
      throw new UserError(`Profile "${name}" already exists. Choose a different name.`)
    }

    // ── Step 2: Agent type ────────────────────────────────────────────────
    stepHeader(2, 6, 'Agent Type')
    const type = await askSelect<AgentType>('Agent type', [
      { name: 'Scout    — reads APYs, posts the best protocol', value: 'scout' },
      { name: 'Executor — executes rebalances when spread > threshold', value: 'executor' },
    ])

    // ── Step 3: Wallet & Security ─────────────────────────────────────────
    stepHeader(3, 6, 'Wallet & Security')
    const privateKey = await askText('Private key (hidden, AES-256 encrypted locally)', (v) =>
      validatePrivateKey(v)
    )
    const wallet = new ethers.Wallet(privateKey)
    console.log('\n  ' + C.muted('Derived wallet: ') + C.accent(wallet.address) + '\n')

    const password = await askPassword('Credential password (encrypts your key at rest)')
    if (password.length < 8) throw new UserError('Password must be at least 8 characters')
    const password2 = await askPassword('Confirm password')
    if (password !== password2) throw new UserError('Passwords do not match')

    // ── Step 4: Payment & Endpoint ────────────────────────────────────────
    stepHeader(4, 6, 'Payment & Endpoint')
    const developerWallet = await askText(
      'Developer wallet (receives USDC job payments)',
      validateAddress
    )
    const endpoint = await askText('Agent endpoint URL (https://...)', validateURL)
    let fee = 0
    if (type === 'executor') {
      const feeStr = await askText('Job fee in basis points, max 500 (50 = 0.5%)', validateFee)
      fee = parseInt(feeStr, 10)
    } else {
      console.log('  ' + C.muted('Scout agents have no fee — scouting is free.\n'))
    }

    // ── Step 5: Preflight checks ──────────────────────────────────────────
    stepHeader(5, 6, 'Pre-flight Checks')
    const spinner = new Spinner('Checking wallet on Fuji testnet...').start()
    const client = new ChainClient(privateKey)
    const preflight = await PreflightCheck.run(client, name, type)
    spinner.stop()

    console.log('')
    ok(`Wallet:  ${preflight.wallet}`)
    ok(`AVAX:    ${preflight.avax.toFixed(4)} AVAX`)
    ok(`USDC:    ${preflight.usdc.toFixed(2)} USDC`)
    ok(`Network: Avalanche Fuji (Chain ID: 43113)`)
    preflight.warnings.forEach((w) => warn(w))

    if (!preflight.ok) {
      errorBox('Preflight Failed', preflight.errors)
      process.exit(1)
    }

    // ── Step 6: On-chain registration ─────────────────────────────────────
    stepHeader(6, 6, 'On-Chain Registration')
    console.log('')

    const regSpinner = new Spinner(
      type === 'executor' ? 'Approving 5 USDC stake...' : 'Registering scout on-chain...'
    ).start()
    const result = await Registrar.register(
      client,
      { type, endpoint, fee, developerWallet },
      (step) => {
        if (step === 'registering') regSpinner.update('Registering agent on-chain...')
      }
    )
    regSpinner.succeed('Registered on-chain')

    if (result.approveTx) {
      ok(`Approved   · ${FUJI_EXPLORER}/tx/${result.approveTx}`)
    }
    ok(`Registered · ${FUJI_EXPLORER}/tx/${result.registerTx}`)

    // Save credentials (raw key in encryptedKey field — encrypted on save)
    const profile: AgentProfile = {
      name,
      type,
      wallet: wallet.address,
      encryptedKey: privateKey,
      developerWallet,
      endpoint,
      fee,
      network: 'fuji',
      registeredAt: new Date().toISOString(),
      registrationTx: result.registerTx,
    }
    CredentialManager.saveProfile(profile, password)
    ok(`Saved to ${CredentialManager.credFilePath}`)

    // Mirror the key into the repo .env so the process runner (run-4-agents.js)
    // can launch this agent without manual copy-paste.
    try {
      const env = syncAgentToEnv({ type, wallet: wallet.address, privateKey, developerWallet })
      ok(`Wrote ${env.slotName}_PRIVATE_KEY to ${env.path}`)
    } catch (e: any) {
      warn(`Could not update .env automatically: ${e.message}`)
    }

    // Scouts must be authorized in YieldRegistry before they can post APY
    // results (updateBestProtocol). This is an owner-only action — automate it
    // if the registry owner key is available, otherwise tell the operator.
    if (type === 'scout') {
      try {
        const authed = await Registrar.isScoutAuthorized(client)
        if (authed) {
          ok('Scout already authorized in YieldRegistry')
        } else {
          const ownerKey =
            readEnvValue('ORBIT_REGISTRY_OWNER_KEY') || readEnvValue('DEPLOYER_PRIVATE_KEY')
          if (ownerKey) {
            const authTx = await Registrar.authorizeScout(ownerKey, wallet.address)
            if (authTx) ok(`Authorized scout in YieldRegistry · ${FUJI_EXPLORER}/tx/${authTx}`)
            else ok('Scout already authorized in YieldRegistry')
          } else {
            warn('Scout is registered but NOT yet authorized to post APY results.')
            warn(`The registry owner must call: YieldRegistry.authorizeAgent(${wallet.address})`)
            warn('Set DEPLOYER_PRIVATE_KEY (or ORBIT_REGISTRY_OWNER_KEY) in .env to automate this.')
          }
        }
      } catch (e: any) {
        warn(`Scout authorization step failed: ${e.message}`)
        warn(`Owner can run manually: YieldRegistry.authorizeAgent(${wallet.address})`)
      }
    }

    const infoLines = [
      `  ${C.muted('Wallet:')}     ${C.accent(wallet.address)}`,
      `  ${C.muted('Type:')}       ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    ]
    if (type === 'executor') {
      infoLines.push(`  ${C.muted('Fee:')}        ${(fee / 100).toFixed(2)}% per successful job`)
      infoLines.push(`  ${C.muted('Stake:')}      5.00 USDC locked`)
    } else {
      infoLines.push(`  ${C.muted('Fee:')}        Free (no fee for scouting)`)
      infoLines.push(`  ${C.muted('Stake:')}      None required`)
    }
    infoLines.push(
      `  ${C.muted('Reputation:')} 0 (warmup — jobs start immediately)`,
      ``,
      `  ${C.muted('Start earning: ')} ${C.primary('orbit run --agent ' + name)}`,
      `  ${C.muted('Check status:  ')} ${C.primary('orbit status --agent ' + name)}`,
    )
    successBox(`Agent "${name}" is live on Orbit!`, infoLines)
  } catch (err: any) {
    if (err instanceof ChainError) {
      errorBox('Transaction Failed', [
        err.message,
        err.txHash ? `tx: ${FUJI_EXPLORER}/tx/${err.txHash}` : '',
        'Check your AVAX balance and try again.',
      ])
    } else if (err instanceof UserError) {
      fail(err.message)
    } else {
      errorBox('Setup Failed', [err.message])
      if (process.env.DEBUG?.includes('orbit')) console.error(err.stack)
    }
    process.exit(1)
  }
})

export default cmd
