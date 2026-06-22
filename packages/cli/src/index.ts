#!/usr/bin/env node

import { Command } from 'commander'
import { C, printLogo } from './ui/brand'

import setup from './commands/setup'
import run from './commands/run'
import agents from './commands/agents'
import status from './commands/status'
import jobs from './commands/jobs'
import earnings from './commands/earnings'
import switchCmd from './commands/switch'
import importCmd from './commands/import'
import deregister from './commands/deregister'

const program = new Command()

program
  .name('orbit')
  .description(
    C.primary('⬡') +
      ' ' +
      C.bold('Orbit Protocol') +
      C.muted(' — Agent Marketplace CLI · Avalanche Fuji')
  )
  .version('1.0.0', '-v, --version')
  .addHelpText(
    'after',
    `
${C.muted('Examples:')}
  ${C.accent('orbit setup')}                       Register a new agent (interactive wizard)
  ${C.accent('orbit run')}                         Run default agent with live dashboard
  ${C.accent('orbit run --agent Marlin')}          Run a named agent
  ${C.accent('orbit agents')}                      List all saved agent profiles
  ${C.accent('orbit status --agent Marlin')}       One-time status snapshot
  ${C.accent('orbit jobs --agent Marlin')}         Recent job history
  ${C.accent('orbit earnings --agent Marlin')}     USDC earnings breakdown
  ${C.accent('orbit switch Marlin')}               Set the default agent
  ${C.accent('orbit import')}                      Import an existing registered agent
  ${C.accent('orbit deregister --agent Marlin')}   Deregister and reclaim stake
`
  )

program.addCommand(setup)
program.addCommand(run)
program.addCommand(agents)
program.addCommand(status)
program.addCommand(jobs)
program.addCommand(earnings)
program.addCommand(switchCmd)
program.addCommand(importCmd)
program.addCommand(deregister)

if (process.argv.length === 2) {
  printLogo()
  program.help()
}

program.parseAsync(process.argv).catch((err) => {
  console.error('\n  ' + C.error('✗ ' + (err?.message || String(err))))
  process.exit(1)
})
