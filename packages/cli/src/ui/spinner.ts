import chalk from 'chalk'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export class Spinner {
  private frame = 0
  private interval: NodeJS.Timeout | null = null
  private label: string

  constructor(label: string) {
    this.label = label
  }

  start(): this {
    process.stdout.write('  ')
    this.interval = setInterval(() => {
      process.stdout.write(
        `\r  ${chalk.hex('#06B6D4')(FRAMES[this.frame++ % FRAMES.length]!)} ${this.label}`
      )
    }, 80)
    return this
  }

  update(label: string): void {
    this.label = label
  }

  succeed(msg: string): void {
    this.stop()
    process.stdout.write(`\r  ${chalk.green('✓')} ${msg}\x1b[K\n`)
  }

  fail(msg: string): void {
    this.stop()
    process.stdout.write(`\r  ${chalk.red('✗')} ${msg}\x1b[K\n`)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
      process.stdout.write('\r\x1b[K')
    }
  }
}
