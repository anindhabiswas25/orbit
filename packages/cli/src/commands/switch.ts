import { Command } from 'commander'
import { CredentialManager } from '@orbit/core'
import { ok, fail, C } from '../ui/brand'

const cmd = new Command('switch')
cmd.description('Set the default agent (used when --agent flag is omitted)')
cmd.argument('<name>', 'Agent profile name to set as default')

cmd.action((name: string) => {
  try {
    CredentialManager.setDefault(name)
    ok(`"${name}" is now the default agent`)
    console.log(C.muted('  You can now run: orbit run   (without --agent)'))
  } catch (err: any) {
    fail(err.message)
    process.exit(1)
  }
})

export default cmd
