/// Verification module: optimistic settlement of a seeded round.
///
///   submit_result (operator bond, hash checked) → challenge window (sui::clock)
///     ├─ no challenge, window over → finalize: pay player, return operator bond
///     └─ challenge (challenger bond) → select_committee (sui::random, separate tx) → vote × 3
///          ├─ 2 matching votes → settled by the committee (§11.3 rewards and slashing)
///          └─ vote deadline passes undecided → resolve_by_admin (fallback)
///
/// The submitted result and the dispute are dynamic fields on the `Round`; the verifier pool
/// lives in the `House` (`committee` module). Status changes go through
/// the transitions in `round`. In every entry function the transition runs first, so a call in
/// the wrong state aborts with the round's status error; any later abort reverts it.
/// Design and open decisions: docs/CONTRACTS.md. Shared interface: docs/SPEC.md §7.
module pachinko::verification;

use pachinko::committee::{Self, Dispute, Pool};
use pachinko::round::{AdminCap, Round};
use std::bcs;
use std::hash;
use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::dynamic_field as df;
use sui::event;
use sui::random::Random;
use sui::sui::SUI;

// === Errors ===

const EInvalidHouseConfig: u64 = 0;
const EWrongBallCount: u64 = 1;
const EInvalidOutcome: u64 = 2;
const EHashMismatch: u64 = 3;
const EWrongBond: u64 = 4;
const EWrongHouse: u64 = 5;
const EWindowClosed: u64 = 6;
const EWindowOpen: u64 = 7;
const EHouseInsolvent: u64 = 8;
const ENoDispute: u64 = 9;

// === Constants ===

/// On-chain outcome for a ball that never landed (`-1` in physics; same bytes as i16 BE).
const OUTCOME_NONE: u16 = 0xFFFF;
/// Domain tag of the result hash (docs/SPEC.md §3).
const RESULT_TAG: vector<u8> = b"PACHINKO-RESULT-V1";
/// Multipliers are in basis points: 10_000 = 1×.
const BPS: u128 = 10_000;
/// 100×. Keeps `bet × Σ multipliers` far inside u128.
const MAX_MULTIPLIER_BPS: u64 = 1_000_000;

// === Objects ===

/// Lets its holder submit round results.
public struct OperatorCap has key, store { id: UID }

/// Shared house: treasury that pays winnings, the payout table, and verification settings.
public struct House has key {
    id: UID,
    treasury: Balance<SUI>,
    /// Payout per pocket in basis points; its length is the number of pockets.
    multipliers_bps: vector<u64>,
    balls_per_round: u64,
    operator_bond: u64,
    challenger_bond: u64,
    challenge_window_ms: u64,
    /// How long the committee has to vote after a challenge.
    vote_window_ms: u64,
    /// Staked verifiers that challenged rounds draw their committee from.
    pool: Pool,
}

/// Dynamic-field key of the `Submission` on a `Round`.
public struct SubmissionKey() has copy, drop, store;

/// Dynamic-field key of the `Dispute` on a challenged `Round` (removed when it is settled).
public struct DisputeKey() has copy, drop, store;

/// Result posted for a round. Stays on the round after settlement as its final result.
public struct Submission has store {
    house: ID,
    operator: address,
    outcomes: vector<u16>,
    result_hash: vector<u8>,
    /// Challenges are accepted while `now < deadline_ms`; finalize from `deadline_ms` on.
    deadline_ms: u64,
    operator_bond: Balance<SUI>,
    challenger: Option<address>,
    challenger_bond: Balance<SUI>,
}

// === Events ===

public struct ResultSubmitted has copy, drop {
    round: ID,
    round_id: u64,
    operator: address,
    outcomes: vector<u16>,
    result_hash: vector<u8>,
    bond: u64,
    deadline_ms: u64,
}

public struct Challenged has copy, drop {
    round: ID,
    round_id: u64,
    challenger: address,
    bond: u64,
}

public struct Resolved has copy, drop {
    round: ID,
    round_id: u64,
    operator_honest: bool,
    winner: address,
    /// Paid to `winner`: both bonds (admin fallback), or its own bond + half the loser's (committee).
    award: u64,
    /// Settled by the committee's votes (true) or by the admin fallback (false).
    by_committee: bool,
    /// Hash of the correct result (the one the player is paid from).
    result_hash: vector<u8>,
}

public struct CommitteeSelected has copy, drop {
    round: ID,
    round_id: u64,
    committee: vector<address>,
    deadline_ms: u64,
}

public struct Voted has copy, drop {
    round: ID,
    round_id: u64,
    voter: address,
    result_hash: vector<u8>,
}

public struct Finalized has copy, drop {
    round: ID,
    round_id: u64,
    player: address,
    payout: u64,
    result_hash: vector<u8>,
}

// === Admin ===

/// Gives `recipient` an `OperatorCap`.
public fun issue_operator_cap(_: &AdminCap, recipient: address, ctx: &mut TxContext) {
    transfer::public_transfer(OperatorCap { id: object::new(ctx) }, recipient);
}

/// Creates and shares an empty `House`. Fund it with `fund_house` before rounds finalize.
public fun create_house(
    _: &AdminCap,
    multipliers_bps: vector<u64>,
    balls_per_round: u64,
    operator_bond: u64,
    challenger_bond: u64,
    challenge_window_ms: u64,
    verifier_stake: u64,
    vote_window_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(!multipliers_bps.is_empty(), EInvalidHouseConfig);
    assert!(multipliers_bps.all!(|m| *m <= MAX_MULTIPLIER_BPS), EInvalidHouseConfig);
    assert!(balls_per_round > 0, EInvalidHouseConfig);
    assert!(operator_bond > 0 && challenger_bond > 0 && verifier_stake > 0, EInvalidHouseConfig);
    assert!(challenge_window_ms > 0 && vote_window_ms > 0, EInvalidHouseConfig);

    transfer::share_object(House {
        id: object::new(ctx),
        treasury: balance::zero(),
        multipliers_bps,
        balls_per_round,
        operator_bond,
        challenger_bond,
        challenge_window_ms,
        vote_window_ms,
        pool: committee::new_pool(verifier_stake, ctx),
    });
}

/// Adds `funds` to the house treasury.
public fun fund_house(house: &mut House, funds: Coin<SUI>) {
    house.treasury.join(funds.into_balance());
}

/// Takes `amount` out of the house treasury.
public fun withdraw_house(
    _: &AdminCap,
    house: &mut House,
    amount: u64,
    ctx: &mut TxContext,
): Coin<SUI> {
    coin::from_balance(house.treasury.split(amount), ctx)
}

// === Verifiers ===

/// Joins the house's verifier pool; `stake` must be exactly the house's verifier stake.
public fun join_pool(house: &mut House, stake: Coin<SUI>, ctx: &mut TxContext) {
    house.pool.join(ctx.sender(), stake.into_balance());
}

/// Leaves the pool and returns the stake. Aborts while drawn for an unsettled dispute.
public fun leave_pool(house: &mut House, ctx: &mut TxContext): Coin<SUI> {
    coin::from_balance(house.pool.leave(ctx.sender()), ctx)
}

// === Operator ===

/// Posts the round's outcomes and their hash, locks the operator bond and starts the
/// challenge window (SEEDED → SUBMITTED). Aborts unless `result_hash` is the SPEC hash of
/// `outcomes` for this round's seed, id and config version.
public fun submit_result(
    _: &OperatorCap,
    round: &mut Round,
    house: &House,
    outcomes: vector<u16>,
    result_hash: vector<u8>,
    bond: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    round.mark_submitted();
    assert_valid_outcomes(house, &outcomes);
    assert!(round_result_hash(round, &outcomes) == result_hash, EHashMismatch);
    assert!(bond.value() == house.operator_bond, EWrongBond);

    let deadline_ms = clock.timestamp_ms() + house.challenge_window_ms;
    event::emit(ResultSubmitted {
        round: object::id(round),
        round_id: round.round_id(),
        operator: ctx.sender(),
        outcomes,
        result_hash,
        bond: bond.value(),
        deadline_ms,
    });
    df::add(round.uid_mut(), SubmissionKey(), Submission {
        house: object::id(house),
        operator: ctx.sender(),
        outcomes,
        result_hash,
        deadline_ms,
        operator_bond: bond.into_balance(),
        challenger: option::none(),
        challenger_bond: balance::zero(),
    });
}

// === Anyone ===

/// Disputes the submitted result during the window by locking the challenger bond
/// (SUBMITTED → CHALLENGED) and opens the committee vote, which runs for `vote_window_ms`.
public fun challenge(
    round: &mut Round,
    house: &House,
    bond: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    round.mark_challenged();
    let round_ref = object::id(round);
    let round_id = round.round_id();
    let submission = submission_mut(round, house);
    assert!(clock.timestamp_ms() < submission.deadline_ms, EWindowClosed);
    assert!(bond.value() == house.challenger_bond, EWrongBond);

    submission.challenger = option::some(ctx.sender());
    submission.challenger_bond.join(bond.into_balance());
    event::emit(Challenged { round: round_ref, round_id, challenger: ctx.sender(), bond: house.challenger_bond });
    let excluded = vector[submission.operator, ctx.sender(), round.player()];
    let dispute = committee::new_dispute(clock.timestamp_ms() + house.vote_window_ms, excluded);
    df::add(round.uid_mut(), DisputeKey(), dispute);
}

/// Draws the challenged round's committee at random (3 verifiers, never the operator, the
/// challenger or the player). Its own transaction after `challenge`, so nobody can retry the draw
/// by aborting (the reason `draw_seed` is separate too).
entry fun select_committee(
    round: &mut Round,
    house: &mut House,
    r: &Random,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let mut rng = r.new_generator(ctx);
    let committee = dispute_mut(round).draw(&mut house.pool, &mut rng, clock.timestamp_ms());
    assert_round_house(round, house); // else the draw used another house's pool (and this reverts it)
    event::emit(CommitteeSelected {
        round: object::id(round),
        round_id: round.round_id(),
        committee,
        deadline_ms: dispute(round).deadline_ms(),
    });
}

/// A drawn verifier posts the outcomes it computed by re-running the round. The second vote with
/// the same hash settles the round (CHALLENGED → FINALIZED, see `resolve`).
public fun vote(
    round: &mut Round,
    house: &mut House,
    outcomes: vector<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_valid_outcomes(house, &outcomes);
    let result_hash = round_result_hash(round, &outcomes);
    event::emit(Voted { round: object::id(round), round_id: round.round_id(), voter: ctx.sender(), result_hash });
    let decided = dispute_mut(round).record_vote(ctx.sender(), result_hash, clock.timestamp_ms());
    if (decided) resolve(round, house, outcomes, true, ctx);
}

/// After an unchallenged window: pays the player from the submitted outcomes and returns
/// the operator bond (SUBMITTED → FINALIZED).
public fun finalize(round: &mut Round, house: &mut House, clock: &Clock, ctx: &mut TxContext) {
    let bet = round.finalize_unchallenged();
    let submission = submission_mut(round, house);
    assert!(clock.timestamp_ms() >= submission.deadline_ms, EWindowOpen);

    let bond = submission.operator_bond.withdraw_all();
    transfer::public_transfer(coin::from_balance(bond, ctx), submission.operator);
    settle(round, house, bet, ctx);
}

// === Arbitration ===

/// Fallback arbiter: once the vote deadline has passed without a decision, the admin posts the
/// correct outcomes (CHALLENGED → FINALIZED). See `resolve` for the verdict rule.
public fun resolve_by_admin(
    _: &AdminCap,
    round: &mut Round,
    house: &mut House,
    correct_outcomes: vector<u16>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    dispute_mut(round).assert_voting_closed(clock.timestamp_ms());
    resolve(round, house, correct_outcomes, false, ctx);
}

/// Settles a dispute from `correct_outcomes`: the operator was honest exactly when their hash
/// equals the correct one. The stored result becomes the correct one and the player is paid
/// from it. Bonds: by the committee, the winner gets its own bond + half the loser's and the
/// majority voters split the other half; by the admin fallback, the winner gets both.
/// `committee::settle` then pays and slashes the drawn verifiers.
fun resolve(
    round: &mut Round,
    house: &mut House,
    correct_outcomes: vector<u16>,
    by_committee: bool,
    ctx: &mut TxContext,
) {
    let bet = round.finalize_disputed();
    assert_valid_outcomes(house, &correct_outcomes);
    let correct_hash = round_result_hash(round, &correct_outcomes);
    let round_ref = object::id(round);
    let round_id = round.round_id();

    let submission = submission_mut(round, house);
    let operator_honest = submission.result_hash == correct_hash;
    let winner = if (operator_honest) submission.operator else *submission.challenger.borrow();
    let operator_bond = submission.operator_bond.withdraw_all();
    let challenger_bond = submission.challenger_bond.withdraw_all();
    let (mut award, mut loser_bond) =
        if (operator_honest) (operator_bond, challenger_bond) else (challenger_bond, operator_bond);
    let half = loser_bond.value() / 2;
    let voter_reward = if (by_committee) loser_bond.split(half) else balance::zero();
    award.join(loser_bond);
    submission.outcomes = correct_outcomes;
    submission.result_hash = correct_hash;

    let award_value = award.value();
    transfer::public_transfer(coin::from_balance(award, ctx), winner);
    let dispute: Dispute = df::remove(round.uid_mut(), DisputeKey());
    let unclaimed = dispute.settle(&mut house.pool, &correct_hash, by_committee, voter_reward, ctx);
    house.treasury.join(unclaimed);

    event::emit(Resolved {
        round: round_ref,
        round_id,
        operator_honest,
        winner,
        award: award_value,
        by_committee,
        result_hash: correct_hash,
    });
    settle(round, house, bet, ctx);
}

// === Settlement ===

/// Pays the player from the stored result and emits `Finalized`.
fun settle(round: &Round, house: &mut House, bet: Balance<SUI>, ctx: &mut TxContext) {
    let submission: &Submission = df::borrow(round.uid(), SubmissionKey());
    let payout = pay_out(house, bet, &submission.outcomes, round.player(), ctx);
    event::emit(Finalized {
        round: object::id(round),
        round_id: round.round_id(),
        player: round.player(),
        payout,
        result_hash: submission.result_hash,
    });
}

/// Placeholder payout rule (open decision in docs/CONTRACTS.md §6–7): each ball stakes
/// `bet / ball_count` and wins `stake × multipliers_bps[pocket] / 10_000`; a ball that never
/// landed pays 0. Summed in u128 and divided once, so per-ball rounding loses nothing.
/// The bet joins the treasury and the payout is paid from it. Returns the payout.
fun pay_out(
    house: &mut House,
    bet: Balance<SUI>,
    outcomes: &vector<u16>,
    player: address,
    ctx: &mut TxContext,
): u64 {
    let mut total_bps: u128 = 0;
    outcomes.do_ref!(|o| {
        if (*o != OUTCOME_NONE) total_bps = total_bps + (house.multipliers_bps[*o as u64] as u128);
    });
    let ball_count = outcomes.length() as u128;
    let payout = ((bet.value() as u128) * total_bps / (ball_count * BPS)) as u64;

    house.treasury.join(bet);
    assert!(house.treasury.value() >= payout, EHouseInsolvent);
    if (payout > 0) {
        transfer::public_transfer(coin::from_balance(house.treasury.split(payout), ctx), player);
    };
    payout
}

// === Result hash ===

/// SHA-256 of a round result in the docs/SPEC.md §3 byte layout (equals `hashRoundResult`
/// in physics): "PACHINKO-RESULT-V1" ‖ u16 len(version) ‖ version ‖ seed ‖ u64 round_id
/// ‖ u32 ball_count ‖ i16 outcome × ball_count, all big-endian.
public fun result_hash(
    config_version: &String,
    seed: &vector<u8>,
    round_id: u64,
    outcomes: &vector<u16>,
): vector<u8> {
    let version = config_version.as_bytes();
    let mut bytes = RESULT_TAG;
    append_be(&mut bytes, version.length() as u16);
    bytes.append(*version);
    bytes.append(*seed);
    append_be(&mut bytes, round_id);
    append_be(&mut bytes, outcomes.length() as u32);
    outcomes.do_ref!(|o| append_be(&mut bytes, *o));
    hash::sha2_256(bytes)
}

/// `result_hash` for `outcomes` on this round's seed, id and config version.
fun round_result_hash(round: &Round, outcomes: &vector<u16>): vector<u8> {
    result_hash(round.config_version(), round.seed(), round.round_id(), outcomes)
}

/// Appends a fixed-width unsigned integer big-endian (BCS writes it little-endian).
fun append_be<T: drop>(bytes: &mut vector<u8>, value: T) {
    let mut le = bcs::to_bytes(&value);
    le.reverse();
    bytes.append(le);
}

// === Reads ===

/// Hash of the round's stored result (the corrected one after a successful challenge).
public fun submitted_hash(round: &Round): &vector<u8> {
    let submission: &Submission = df::borrow(round.uid(), SubmissionKey());
    &submission.result_hash
}

/// SUI in the house treasury.
public fun treasury_value(house: &House): u64 { house.treasury.value() }

/// The house's verifier pool.
public fun pool(house: &House): &Pool { &house.pool }

/// The open dispute of a challenged round (committee, deadline, votes).
public fun dispute(round: &Round): &Dispute {
    assert!(df::exists(round.uid(), DisputeKey()), ENoDispute);
    df::borrow(round.uid(), DisputeKey())
}

// === Helpers ===

/// One outcome per ball, each a pocket id or `OUTCOME_NONE`.
fun assert_valid_outcomes(house: &House, outcomes: &vector<u16>) {
    assert!(outcomes.length() == house.balls_per_round, EWrongBallCount);
    let pockets = house.multipliers_bps.length();
    assert!(outcomes.all!(|o| *o == OUTCOME_NONE || (*o as u64) < pockets), EInvalidOutcome);
}

/// The open dispute of a challenged round.
fun dispute_mut(round: &mut Round): &mut Dispute {
    assert!(df::exists(round.uid(), DisputeKey()), ENoDispute);
    df::borrow_mut(round.uid_mut(), DisputeKey())
}

/// Aborts unless the round's result was submitted to `house`.
fun assert_round_house(round: &Round, house: &House) {
    let submission: &Submission = df::borrow(round.uid(), SubmissionKey());
    assert!(submission.house == object::id(house), EWrongHouse);
}

/// The round's submission, checked to belong to `house`.
fun submission_mut(round: &mut Round, house: &House): &mut Submission {
    assert_round_house(round, house);
    df::borrow_mut(round.uid_mut(), SubmissionKey())
}
