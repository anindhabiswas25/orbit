import { Command } from 'commander'
import { CredentialManager, ChainClient } from '@orbit/core'
import { inlineLogo, fail, C } from '../ui/brand'
import { askPassword } from '../ui/prompt'
import { Spinner } from '../ui/spinner'

const JOB_STATUS = ['Pending', 'Completed', 'Failed', 'Expired']
const JOB_TYPE = ['Scout', 'Executor']
const STATUS_COLOR: Record<string, (s: string) => string> = {
  Pending: C.warning,
  Completed: C.success,
  Failed: C.error,
  Expired: C.muted,
}

const cmd = new Command('jobs')
cmd.description('Show recent jobs for an agent')
cmd.option('-a, --agent <name>', 'Agent profile name')
cmd.option('-n, --limit <number>', 'Number of jobs to scan', '20')

cmd.action(async (opts) => {
  try {
    const agentName = opts.agent || CredentialManager.getDefault()
    const limit = parseInt(opts.limit, 10)
    console.log('\n  ' + inlineLogo() + C.muted(`  Jobs: ${agentName} (last ${limit})`) + '\n')

    const password = await askPassword(`Unlock "${agentName}"`)
    const profile = CredentialManager.loadProfile(agentName, password)
    const client = new ChainClient(profile.encryptedKey, profile.rpcUrl)

    const spinner = new Spinner('Loading jobs...').start()
    const nextId = Number(await client.contracts.engine.nextJobId())
    const jobs: any[] = []
    for (let id = nextId; id >= Math.max(1, nextId - limit + 1); id--) {
      try {
        const j = await client.contracts.engine.jobs(id)
        if ((j.assignedAgent as string).toLowerCase() === profile.wallet.toLowerCase()) {
          jobs.push(j)
        }
      } catch {
        /* skip */
      }
    }
    spinner.succeed(`${jobs.length} job(s) found`)
    console.log('')

    if (jobs.length === 0) {
      console.log(C.muted('  No jobs found for this wallet yet.\n'))
      return
    }

    for (const j of jobs) {
      const status = JOB_STATUS[Number(j.status)] ?? 'Unknown'
      const type = JOB_TYPE[Number(j.jobType)] ?? 'Unknown'
      const color = STATUS_COLOR[status] ?? C.muted
      const icon =
        status === 'Completed' ? '✓' : status === 'Expired' ? '⌛' : status === 'Failed' ? '✗' : '⏳'
      const date = new Date(Number(j.assignedAt) * 1000).toLocaleString()
      console.log(
        `  ${color(icon)} Job #${Number(j.jobId)} · ${C.muted(type)} · ${color(status)} · ${C.muted(date)}`
      )
    }
    console.log('')
  } catch (err: any) {
    fail(err.message)
    process.exit(1)
  }
})

export default cmd
