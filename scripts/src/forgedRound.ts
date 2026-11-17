/**
 * A forged result caught by a challenge, on Sui testnet:
 *
 *   round → seed → runRound (the true result)   [saved deployment, deploying key = admin + operator]
 *   → operator submits a forged jackpot: every ball in the best pocket, with the matching hash
 *   → challenger disputes it inside the window → admin resolves with the true outcomes
 *   → both bonds go to the challenger; the player is paid from the true result
 *
 * The on-chain hash check can't catch this on its own: the forged hash is correct for the
 * forged outcomes. Only re-running the physics (the challenge) shows they are wrong.
 * Usage: `npm run forged:testnet`. Optional `CHALLENGER_PRIVATE_KEY` (a second address with
 * testnet SUI) makes the bond transfer visible; without it the main key also challenges.
 */
import { DEFAULT_CONFIG, hashRoundResult } from '@pachinko/physics'
import { testnetDeployment } from '@pachinko/chain'
import { loadEnv } from './env'
import { challenge, resolveByAdmin, seededRound, submitResult } from './steps'
import { connect } from './sui'

const BPS = 10_000n

/** Every ball in the pocket with the highest multiplier. */
function forgedJackpot(multipliersBps: readonly bigint[]): { pocket: number; outcomes: number[] } {
  const pocket = multipliersBps.reduce((best, m, i) => (m > multipliersBps[best] ? i : best), 0)
  return { pocket, outcomes: Array(DEFAULT_CONFIG.timing.ballsPerRound).fill(pocket) }
}

async function main() {
  const env = loadEnv()
  const sui = connect(env.grpcUrl, env.privateKey)
  const challenger = connect(env.grpcUrl, env.challengerPrivateKey)
  console.log(`address          ${sui.address}`)
  console.log(`challenger       ${challenger.address}\n`)

  const deployment = testnetDeployment()
  const { round, seed, result } = await seededRound(sui, env, deployment)
  const forged = forgedJackpot(env.multipliersBps)
  const forgedHash = hashRoundResult({
    version: DEFAULT_CONFIG.version,
    seed,
    roundId: round.roundId,
    outcomes: forged.outcomes,
  })
  console.log(`  operator forges: all ${forged.outcomes.length} balls in pocket ${forged.pocket}`)
  await submitResult(sui, deployment, round, forged.outcomes, forgedHash)
  await challenge(challenger, deployment, round)
  const resolution = await resolveByAdmin(sui, deployment, round, result.outcomes)

  const forgedPayout = (env.betMist * env.multipliersBps[forged.pocket]) / BPS
  console.log(`\npackage          ${deployment.packageId}`)
  console.log(`round object     ${round.objectId}`)
  console.log(`verdict          operator ${resolution.operatorHonest ? 'honest' : 'forged'}`)
  console.log(`bonds → winner   ${resolution.award} MIST → ${resolution.winner}`)
  console.log(`payout           ${resolution.payout} MIST (forged claim: ${forgedPayout} MIST)`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
