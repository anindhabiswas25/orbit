import chalk from 'chalk'

// ─── Color helpers ───────────────────────────────────────────────────────────
// Import from here only — never call chalk directly in command files.
export const C = {
  primary: (s: string) => chalk.hex('#7C3AED')(s),
  secondary: (s: string) => chalk.hex('#2563EB')(s),
  accent: (s: string) => chalk.hex('#06B6D4')(s),
  success: (s: string) => chalk.green(s),
  warning: (s: string) => chalk.yellow(s),
  error: (s: string) => chalk.red(s),
  muted: (s: string) => chalk.gray(s),
  bold: (s: string) => chalk.bold(s),
  dim: (s: string) => chalk.dim(s),
  white: (s: string) => chalk.white(s),
  link: (s: string) => chalk.hex('#06B6D4').underline(s),
} as const

// ─── Gradient engine (no deps — pure chalk hex interpolation) ─────────────────
type RGB = [number, number, number]
function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
// Sample a multi-stop gradient at t ∈ [0,1].
function sampleGradient(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0]!
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2)
  const f = x - i
  const a = hexToRgb(stops[i]!)
  const b = hexToRgb(stops[i + 1]!)
  return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
}

// Brand gradient: violet → blue → cyan (top-to-bottom, matching the dashboard).
const BRAND_STOPS = ['#A855F7', '#7C3AED', '#4F46E5', '#2563EB', '#06B6D4']

// ─── ASCII Logo ──────────────────────────────────────────────────────────────
// Chunky block-letter wordmark with a vertical violet→cyan gradient.
// Displayed on: orbit setup (first run), orbit run (startup), bare `orbit`.
const ORBIT_GLYPHS: string[][] = [
  // O          R           B           I           T
  ['██████', '██████ ', '██████ ', '██████', '██████'],
  ['██  ██', '██   ██', '██   ██', '  ██  ', '  ██  '],
  ['██  ██', '██████ ', '██████ ', '  ██  ', '  ██  '],
  ['██  ██', '██  ██ ', '██   ██', '  ██  ', '  ██  '],
  ['██  ██', '██   ██', '██   ██', '  ██  ', '  ██  '],
  ['██████', '██   ██', '██████ ', '██████', '  ██  '],
]

export function printLogo(subtitle?: string): void {
  const cols = process.stdout.columns ?? 80
  const rows = ORBIT_GLYPHS.length
  const lines = ORBIT_GLYPHS.map((glyphRow) => glyphRow.join('  '))
  const bannerWidth = Math.max(...lines.map((l) => l.length)) + 2 // + left pad

  console.log('')
  if (cols < bannerWidth) {
    // Narrow terminal — fall back to the compact inline mark.
    console.log('  ' + inlineLogo())
  } else {
    lines.forEach((line, r) => {
      const color = chalk.hex(sampleGradient(BRAND_STOPS, r / (rows - 1)))
      // Pixel shadow: dim the trailing block edge for a subtle 3-D lift.
      console.log('  ' + color.bold(line))
    })
  }

  const tagline = subtitle ?? 'Agent Marketplace'
  console.log(
    '  ' +
      chalk.hex('#A855F7').bold(tagline) +
      chalk.dim('  ·  Avalanche Fuji Testnet')
  )
  console.log(
    '  ' +
      chalk.dim('Autonomous DeFi agents · x402 payments · on-chain reputation')
  )
  console.log('')
}

// ─── Small inline logo (for headers) ─────────────────────────────────────────
export function inlineLogo(): string {
  return chalk.hex('#7C3AED')('⬡') + ' ' + chalk.bold.hex('#7C3AED')('ORBIT')
}

// ─── Section divider ─────────────────────────────────────────────────────────
export function divider(label?: string): void {
  if (label) {
    console.log(C.muted('  ─────────────────────────────────────────────────'))
    console.log(C.muted('  ') + C.accent(label))
    console.log(C.muted('  ─────────────────────────────────────────────────'))
  } else {
    console.log(C.muted('  ─────────────────────────────────────────────────'))
  }
}

// ─── Step header (setup wizard) ──────────────────────────────────────────────
export function stepHeader(current: number, total: number, title: string): void {
  console.log('')
  divider(`Step ${current} of ${total}: ${title}`)
}

// ─── Status lines ────────────────────────────────────────────────────────────
export function ok(msg: string): void {
  console.log('  ' + C.success('✓') + ' ' + msg)
}
export function warn(msg: string): void {
  console.log('  ' + C.warning('⚠') + ' ' + msg)
}
export function fail(msg: string): void {
  console.log('  ' + C.error('✗') + ' ' + msg)
}
export function info(msg: string): void {
  console.log('  ' + C.accent('·') + ' ' + msg)
}

// ─── Boxes ───────────────────────────────────────────────────────────────────
export function successBox(title: string, lines: string[]): void {
  const width = 50
  console.log('')
  console.log(C.success('  ══' + '═'.repeat(width - 4) + '══'))
  console.log(C.success('  ✓  ') + C.bold(title))
  console.log(C.success('  ══' + '═'.repeat(width - 4) + '══'))
  lines.forEach((l) => console.log('  ' + l))
  console.log('')
}

export function errorBox(title: string, lines: string[]): void {
  const width = 50
  console.log('')
  console.log(C.error('  ══' + '═'.repeat(width - 4) + '══'))
  console.log(C.error('  ✗  ') + C.bold(title))
  console.log(C.error('  ══' + '═'.repeat(width - 4) + '══'))
  lines.filter(Boolean).forEach((l) => console.log('  ' + C.error(l)))
  console.log('')
}
