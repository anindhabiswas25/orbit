// Error classification used consistently across CLI and SDK.

/** User made a mistake — show message, do not show stack trace. */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

/** On-chain call failed — retry may help, show tx context. */
export class ChainError extends Error {
  constructor(
    message: string,
    public readonly txHash?: string
  ) {
    super(message)
    this.name = 'ChainError'
  }
}

/** Unrecoverable internal failure — show stack in debug mode. */
export class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
  }
}
