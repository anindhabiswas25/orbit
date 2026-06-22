import { Command } from 'commander'
import { CredentialManager } from '@orbit/core'
import { inlineLogo, C } from '../ui/brand'

const cmd = new Command('agents')
cmd.description('List all saved agent profiles')

cmd.action(() => {
  console.log('\n  ' + inlineLogo() + C.muted('  Saved Agents') + '\n')

  const profiles = CredentialManager.listProfiles()
  const defaultName = CredentialManager.read().default

  if (profiles.length === 0) {
    console.log(C.muted('  No agents found. Run orbit setup to register your first agent.\n'))
    return
  }

  const cols = ['Name', 'Type', 'Wallet', 'Default']
  const widths = [16, 10, 22, 8]
  const hr = cols.map((_, i) => '─'.repeat(widths[i]!))
  const row = (cells: string[]) =>
    '  │ ' + cells.map((c, i) => padCell(c, widths[i]!)).join(' │ ') + ' │'

  console.log('  ┌' + hr.map((h) => h + '─').join('┬') + '┐')
  console.log(row(cols.map((c) => C.muted(c))))
  console.log('  ├' + hr.map((h) => h + '─').join('┼') + '┤')

  for (const p of profiles) {
    const isDefault = p.name === defaultName
    const walletShort = p.wallet.slice(0, 10) + '…' + p.wallet.slice(-4)
    console.log(
      row([
        (isDefault ? C.success('● ') : '  ') + C.bold(p.name),
        p.type.charAt(0).toUpperCase() + p.type.slice(1),
        C.muted(walletShort),
        isDefault ? C.success('✓') : '',
      ])
    )
  }

  console.log('  └' + hr.map((h) => h + '─').join('┴') + '┘')
  console.log('')
  console.log(C.muted(`  ${profiles.length} agent(s) saved to ${CredentialManager.credFilePath}`))
  console.log(C.muted('  Run orbit status --agent <name> for live reputation data'))
  console.log('')
})

// Pad accounting for chalk ANSI escapes (visible length, not byte length).
function padCell(s: string, width: number): string {
  // eslint-disable-next-line no-control-regex
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '').length
  return s + ' '.repeat(Math.max(0, width - visible))
}

export default cmd
