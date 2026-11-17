/**
 * Sui wallet connection: a "Connect <wallet>" button per installed wallet (plus the Slush web
 * wallet), or the connected address (links to the explorer) with Copy and Disconnect.
 * Uses dApp Kit's hooks with the shared instance.
 */
import { useState } from 'react'
import { useCurrentAccount, useWallets } from '@mysten/dapp-kit-react'
import { TESTNET_EXPLORER_ACCOUNT } from '@pachinko/chain'
import type { AppDAppKit } from '../onchain/dappKit'

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function WalletPanel({ dAppKit }: { readonly dAppKit: AppDAppKit }) {
  const wallets = useWallets({ dAppKit })
  const account = useCurrentAccount({ dAppKit })
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (account) {
    const copy = () =>
      navigator.clipboard.writeText(account.address).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1_500)
      })
    return (
      <div className="wallet-row">
        <a className="mono" href={`${TESTNET_EXPLORER_ACCOUNT}/${account.address}`} target="_blank" rel="noreferrer">
          {shortAddress(account.address)}
        </a>
        <span className="wallet-actions">
          <button className="link" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button className="link" onClick={() => void dAppKit.disconnectWallet()}>
            Disconnect
          </button>
        </span>
      </div>
    )
  }
  if (wallets.length === 0) {
    return <p className="hint">No Sui wallet found. Install one (e.g. Slush) and switch it to testnet.</p>
  }
  return (
    <div className="wallets">
      {wallets.map((wallet) => (
        <button
          key={wallet.name}
          onClick={() => {
            setError(null)
            dAppKit.connectWallet({ wallet }).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err))
            })
          }}
        >
          <img src={wallet.icon} alt="" width={16} height={16} /> Connect {wallet.name}
        </button>
      ))}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
