import chalk from 'chalk'

/** Animated progress bar. Used for transaction waits. */
export class ProgressBar {
  private width = 20

  render(filled: number, total: number, label: string): void {
    const pct = Math.min(1, filled / total)
    const filledN = Math.round(this.width * pct)
    const emptyN = this.width - filledN
    const bar = chalk.hex('#7C3AED')('█'.repeat(filledN)) + chalk.gray('░'.repeat(emptyN))
    process.stdout.write(`\r  ${bar} ${label}`)
  }

  complete(label: string): void {
    const bar = chalk.green('█'.repeat(this.width))
    process.stdout.write(`\r  ${bar} ${chalk.green('✓')} ${label}\x1b[K\n`)
  }
}

/** Fake-progress a transaction — ticks up to ~95% then resolves on completion. */
export async function txProgress<T>(label: string, promise: Promise<T>): Promise<T> {
  const bar = new ProgressBar()
  let ticks = 0
  const t = setInterval(() => {
    ticks = Math.min(19, ticks + 1)
    bar.render(ticks, 20, label)
  }, 200)

  try {
    const result = await promise
    clearInterval(t)
    bar.complete(label)
    return result
  } catch (err) {
    clearInterval(t)
    process.stdout.write('\n')
    throw err
  }
}
