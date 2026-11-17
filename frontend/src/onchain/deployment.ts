/**
 * Which deployment this page plays on: chain/src/deployments/<VITE_PACHINKO_DEPLOYMENT>.json.
 * VITE_PACHINKO_DEPLOYMENT comes from the repo-root .env (Vite only exposes VITE_ values to the
 * page, so the private keys in that file never reach the browser). Unset = on-chain play is off.
 */
import { DEPLOYMENT_NAME, parseDeployment, type Deployment } from '@pachinko/chain'

/** Every committed deployment file, keyed by its path. */
const FILES = import.meta.glob<unknown>('../../../chain/src/deployments/*.json', {
  eager: true,
  import: 'default',
})

export type OnchainSetup =
  | { readonly enabled: true; readonly name: string; readonly deployment: Deployment }
  | { readonly enabled: false; readonly reason: string }

export function selectDeployment(files: Record<string, unknown>, name: string | undefined): OnchainSetup {
  if (!name) return { enabled: false, reason: 'Set VITE_PACHINKO_DEPLOYMENT in .env to play on-chain.' }
  if (!DEPLOYMENT_NAME.test(name)) return { enabled: false, reason: `Invalid deployment name "${name}".` }
  const file = Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`))
  if (!file) return { enabled: false, reason: `No deployment "${name}" (run npm run deploy:testnet).` }
  return { enabled: true, name, deployment: parseDeployment(file[1]) }
}

export const ONCHAIN: OnchainSetup = selectDeployment(FILES, import.meta.env.VITE_PACHINKO_DEPLOYMENT)
