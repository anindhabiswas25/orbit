import * as http from 'http'
import { EventEmitter } from 'events'
import { ethers } from 'ethers'
import type { X402Receipt, ReceiptReceivedEvent } from './types'

export class ReceiptServer extends EventEmitter {
  private server: http.Server | null = null
  private orchestratorWallet: string

  constructor(orchestratorWallet: string) {
    super()
    this.orchestratorWallet = orchestratorWallet
  }

  start(port: number = 4001): void {
    this.server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Orbit-Version')

      if (req.method === 'OPTIONS') {
        res.writeHead(200); res.end(); return
      }

      if (req.method === 'POST' && req.url === '/x402/receipt') {
        this._handleReceipt(req, res)
        return
      }

      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ready', endpoint: '/x402/receipt' }))
        return
      }

      res.writeHead(404); res.end()
    })

    this.server.listen(port)
  }

  stop(): void {
    this.server?.close()
  }

  private _handleReceipt(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = ''

    req.on('data', (chunk: Buffer) => { body += chunk.toString() })

    req.on('end', () => {
      try {
        const receipt: X402Receipt = JSON.parse(body)

        const { signature, ...unsigned } = receipt
        const canonicalJSON = JSON.stringify(unsigned, Object.keys(unsigned).sort())

        let signer: string
        try {
          signer = ethers.verifyMessage(canonicalJSON, signature)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ received: false, error: 'invalid_signature' }))
          return
        }

        if (signer.toLowerCase() !== this.orchestratorWallet.toLowerCase()) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ received: false, error: 'unauthorized_signer' }))
          return
        }

        const event: ReceiptReceivedEvent = {
          jobId: receipt.jobId,
          amount: receipt.amount,
          settlementTx: receipt.settlementTx,
          explorerUrl: receipt.explorerUrls.settlement,
          reasoning: receipt.reasoning,
          timestamp: new Date(receipt.timestamp),
        }

        this.emit('receipt', event)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: true }))

      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: false, error: 'parse_error' }))
      }
    })
  }
}
