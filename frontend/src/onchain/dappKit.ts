/**
 * Wallet connection (Mysten dApp Kit) for Sui testnet. Created on first use, so pages and tests
 * without on-chain play never load wallet code. Hooks and the ConnectButton get this instance
 * passed in, so no React provider is needed.
 */
import { createDAppKit } from '@mysten/dapp-kit-react'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { TESTNET_GRPC_URL } from '@pachinko/chain'

function create() {
  return createDAppKit({
    networks: ['testnet'],
    createClient: () => new SuiGrpcClient({ network: 'testnet', baseUrl: TESTNET_GRPC_URL }),
    slushWalletConfig: { appName: 'Project Pachinko' },
  })
}

export type AppDAppKit = ReturnType<typeof create>

let instance: AppDAppKit | null = null

export function getDAppKit(): AppDAppKit {
  instance ??= create()
  return instance
}
