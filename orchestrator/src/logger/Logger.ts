import * as winston from 'winston'

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'

const format = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)} [${module}] ${message}${metaStr}`
  })
)

const transport = new winston.transports.Console()

export class Logger {
  private logger: winston.Logger

  constructor(private module: string) {
    this.logger = winston.createLogger({
      level: LOG_LEVEL,
      format,
      defaultMeta: { module },
      transports: [transport],
    })
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta)
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta)
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta)
  }
  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta)
  }
}
