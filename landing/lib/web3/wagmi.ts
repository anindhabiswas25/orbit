import { http, createConfig } from 'wagmi'
import { avalancheFuji } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const FUJI_RPC = 'https://avalanche-fuji-c-chain-rpc.publicnode.com'
export const FUJI_CHAIN_ID = 43113

export const config = createConfig({
  chains: [avalancheFuji],
  connectors: [injected()],
  transports: {
    [avalancheFuji.id]: http(FUJI_RPC),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
