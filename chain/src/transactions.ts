/**
 * Unsigned transactions for every contract call (docs/SPEC.md §7). Callers sign them with a
 * keypair (scripts, operator) or a wallet (frontend). Coins for bets and bonds are split from gas.
 */
import { Transaction } from '@mysten/sui/transactions'
import { fromHex } from '@mysten/sui/utils'
import type { Deployment, HouseSettings } from './deployment'
import { toOnchainOutcomes } from './outcomes'

/** Admin: give `operator` an OperatorCap and create + share the House. */
export function setUpHouseTx(
  packageId: string,
  adminCapId: string,
  operator: string,
  house: HouseSettings,
): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::verification::issue_operator_cap`,
    arguments: [tx.object(adminCapId), tx.pure.address(operator)],
  })
  tx.moveCall({
    target: `${packageId}::verification::create_house`,
    arguments: [
      tx.object(adminCapId),
      tx.pure.vector('u64', house.multipliersBps.map(BigInt)),
      tx.pure.u64(house.ballsPerRound),
      tx.pure.u64(house.operatorBondMist),
      tx.pure.u64(house.challengerBondMist),
      tx.pure.u64(house.challengeWindowMs),
    ],
  })
  return tx
}

/** Anyone: add `amountMist` to the House treasury. */
export function fundHouseTx(packageId: string, houseId: string, amountMist: bigint): Transaction {
  const tx = new Transaction()
  const [funds] = tx.splitCoins(tx.gas, [amountMist])
  tx.moveCall({
    target: `${packageId}::verification::fund_house`,
    arguments: [tx.object(houseId), funds],
  })
  return tx
}

/** Player: lock `betMist` in a new Round. */
export function createRoundTx(d: Deployment, betMist: bigint): Transaction {
  const tx = new Transaction()
  const [bet] = tx.splitCoins(tx.gas, [betMist])
  tx.moveCall({
    target: `${d.packageId}::round::create_round`,
    arguments: [tx.object(d.gameId), bet],
  })
  return tx
}

/** Anyone (the operator in the app): draw the seed with sui::random. */
export function drawSeedTx(d: Deployment, roundObjectId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::round::draw_seed`,
    arguments: [tx.object(roundObjectId), tx.object.random()],
  })
  return tx
}

/** Operator: post outcomes (physics encoding) + result hash (hex) with the operator bond. */
export function submitResultTx(
  d: Deployment,
  roundObjectId: string,
  outcomes: readonly number[],
  resultHashHex: string,
): Transaction {
  const tx = new Transaction()
  const [bond] = tx.splitCoins(tx.gas, [BigInt(d.house.operatorBondMist)])
  tx.moveCall({
    target: `${d.packageId}::verification::submit_result`,
    arguments: [
      tx.object(d.operatorCapId),
      tx.object(roundObjectId),
      tx.object(d.houseId),
      tx.pure.vector('u16', toOnchainOutcomes(outcomes)),
      tx.pure.vector('u8', fromHex(resultHashHex)),
      bond,
      tx.object.clock(),
    ],
  })
  return tx
}

/** Anyone: dispute the submitted result with the challenger bond, before the deadline. */
export function challengeTx(d: Deployment, roundObjectId: string): Transaction {
  const tx = new Transaction()
  const [bond] = tx.splitCoins(tx.gas, [BigInt(d.house.challengerBondMist)])
  tx.moveCall({
    target: `${d.packageId}::verification::challenge`,
    arguments: [tx.object(roundObjectId), tx.object(d.houseId), bond, tx.object.clock()],
  })
  return tx
}

/** Admin: settle a challenged round with the correct outcomes (physics encoding). */
export function resolveByAdminTx(
  d: Deployment,
  roundObjectId: string,
  correctOutcomes: readonly number[],
): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::verification::resolve_by_admin`,
    arguments: [
      tx.object(d.adminCapId),
      tx.object(roundObjectId),
      tx.object(d.houseId),
      tx.pure.vector('u16', toOnchainOutcomes(correctOutcomes)),
    ],
  })
  return tx
}

/** Anyone: after the window, pay the player and return the operator bond. */
export function finalizeTx(d: Deployment, roundObjectId: string): Transaction {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::verification::finalize`,
    arguments: [tx.object(roundObjectId), tx.object(d.houseId), tx.object.clock()],
  })
  return tx
}
