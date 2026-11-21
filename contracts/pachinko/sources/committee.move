/// Committee module: the staked verifier pool and the vote on a challenged round
/// (docs/CONTRACTS.md §11).
///
///   join / leave the pool (exact stake) → challenge opens a `Dispute` → draw 3 verifiers at random
///   → each votes the outcomes it computed → 2 matching votes decide → `settle` pays and slashes
///
/// Only the tally and the pool live here. `verification` owns the entry points, the bonds and the
/// verdict; it keeps the `Pool` inside its `House` and the `Dispute` on the `Round`.
module pachinko::committee;

use sui::balance::Balance;
use sui::coin;
use sui::event;
use sui::random::RandomGenerator;
use sui::sui::SUI;
use sui::table::{Self, Table};

// === Errors ===

const EWrongStake: u64 = 0;
const EAlreadyMember: u64 = 1;
const ENotMember: u64 = 2;
const EOpenDuties: u64 = 3;
const ENotEnoughVerifiers: u64 = 4;
const ECommitteeAlreadyDrawn: u64 = 5;
const ENotInCommittee: u64 = 6;
const EAlreadyVoted: u64 = 7;
const EVotingClosed: u64 = 8;
const EVotingOpen: u64 = 9;

// === Constants ===

/// Verifiers drawn per dispute.
const COMMITTEE_SIZE: u64 = 3;
/// Matching votes that decide a dispute.
const QUORUM: u64 = 2;

// === Objects ===

/// The staked verifiers. `members` is the list the draw indexes into; `verifiers` holds each stake.
public struct Pool has store {
    stake: u64,
    members: vector<address>,
    verifiers: Table<address, Verifier>,
}

public struct Verifier has store {
    stake: Balance<SUI>,
    /// Disputes this verifier is drawn for that are not settled yet; it cannot leave while > 0.
    open_duties: u64,
}

/// The vote on one challenged round. Votes are accepted while `now < deadline_ms`.
public struct Dispute has store {
    deadline_ms: u64,
    /// Never drawn: the operator, the challenger and the player.
    excluded: vector<address>,
    /// Empty until `draw` runs.
    committee: vector<address>,
    votes: vector<Vote>,
}

public struct Vote has copy, drop, store {
    voter: address,
    result_hash: vector<u8>,
}

// === Events ===

public struct VerifierJoined has copy, drop { verifier: address, stake: u64 }

public struct VerifierLeft has copy, drop { verifier: address, stake: u64 }

/// `amount` was taken from `verifier`'s stake; it left the pool and got the rest back.
public struct VerifierSlashed has copy, drop { verifier: address, amount: u64 }

// === Pool ===

public(package) fun new_pool(stake: u64, ctx: &mut TxContext): Pool {
    Pool { stake, members: vector[], verifiers: table::new(ctx) }
}

/// Adds `who` with exactly `pool.stake`.
public(package) fun join(pool: &mut Pool, who: address, stake: Balance<SUI>) {
    assert!(stake.value() == pool.stake, EWrongStake);
    assert!(!pool.verifiers.contains(who), EAlreadyMember);
    event::emit(VerifierJoined { verifier: who, stake: stake.value() });
    pool.members.push_back(who);
    pool.verifiers.add(who, Verifier { stake, open_duties: 0 });
}

/// Removes `who` and returns its stake. Aborts while it is drawn for an unsettled dispute.
public(package) fun leave(pool: &mut Pool, who: address): Balance<SUI> {
    assert!(pool.verifiers.contains(who), ENotMember);
    assert!(pool.verifiers[who].open_duties == 0, EOpenDuties);
    let stake = remove(pool, who);
    event::emit(VerifierLeft { verifier: who, stake: stake.value() });
    stake
}

/// Addresses in the pool.
public fun members(pool: &Pool): &vector<address> { &pool.members }

// === Dispute ===

public(package) fun new_dispute(deadline_ms: u64, excluded: vector<address>): Dispute {
    Dispute { deadline_ms, excluded, committee: vector[], votes: vector[] }
}

/// Draws `COMMITTEE_SIZE` distinct verifiers from the pool, never the excluded parties, and
/// returns them. Call only from a non-public `entry` function that owns the `RandomGenerator`,
/// in a transaction after the challenge.
public(package) fun draw(
    dispute: &mut Dispute,
    pool: &mut Pool,
    rng: &mut RandomGenerator,
    now_ms: u64,
): vector<address> {
    assert!(dispute.committee.is_empty(), ECommitteeAlreadyDrawn);
    assert!(now_ms < dispute.deadline_ms, EVotingClosed);
    let mut eligible = pool.members.filter!(|m| !dispute.excluded.contains(m));
    let count = eligible.length();
    assert!(count >= COMMITTEE_SIZE, ENotEnoughVerifiers);

    // Partial Fisher–Yates shuffle: the first COMMITTEE_SIZE slots end up a uniform sample.
    COMMITTEE_SIZE.do!(|i| eligible.swap(i, rng.generate_u64_in_range(i, count - 1)));
    let committee = vector::tabulate!(COMMITTEE_SIZE, |i| eligible[i]);
    committee.do_ref!(|m| {
        let verifier = &mut pool.verifiers[*m];
        verifier.open_duties = verifier.open_duties + 1;
    });
    dispute.committee = committee;
    committee
}

/// Records `voter`'s result hash (the caller checked and hashed the outcomes). Returns true once
/// `QUORUM` votes share it: the voter's outcomes then decide the dispute.
public(package) fun record_vote(dispute: &mut Dispute, voter: address, result_hash: vector<u8>, now_ms: u64): bool {
    assert!(now_ms < dispute.deadline_ms, EVotingClosed);
    assert!(dispute.committee.contains(&voter), ENotInCommittee);
    assert!(!dispute.votes.any!(|v| v.voter == voter), EAlreadyVoted);

    let agreeing = dispute.votes.count!(|v| v.result_hash == result_hash) + 1;
    dispute.votes.push_back(Vote { voter, result_hash });
    agreeing >= QUORUM
}

/// Aborts unless the vote has ended (the admin fallback may settle only after the deadline).
public(package) fun assert_voting_closed(dispute: &Dispute, now_ms: u64) {
    assert!(now_ms >= dispute.deadline_ms, EVotingOpen);
}

/// Pays and slashes the drawn verifiers once the dispute has a verdict (`correct_hash`), and frees
/// the others. Returns what nobody receives (slashed stake after a fallback, rounding dust), for
/// the treasury.
///
///   by the committee: voters with the correct hash split `reward` plus the stake slashed from
///                     voters with another hash; a drawn verifier that had not voted yet is freed
///   by the fallback:  voters with another hash and drawn verifiers that never voted are slashed;
///                     `reward` is empty and the slashed stake goes to the treasury
public(package) fun settle(
    dispute: Dispute,
    pool: &mut Pool,
    correct_hash: &vector<u8>,
    by_committee: bool,
    mut reward: Balance<SUI>,
    ctx: &mut TxContext,
): Balance<SUI> {
    let Dispute { deadline_ms: _, excluded: _, committee, votes } = dispute;
    let mut correct_voters = vector[];
    committee.do!(|member| {
        let vote = votes.find_index!(|v| v.voter == member);
        let voted = vote.is_some();
        let voted_correctly = voted && &votes[vote.destroy_some()].result_hash == correct_hash;
        // Slashed: a wrong vote, or (after a failed committee) no vote at all.
        let slashed = (voted && !voted_correctly) || (!voted && !by_committee);
        if (slashed) {
            reward.join(slash_and_remove(pool, member, ctx));
        } else {
            let verifier = &mut pool.verifiers[member];
            verifier.open_duties = verifier.open_duties - 1;
            if (voted_correctly) correct_voters.push_back(member);
        }
    });

    // A committee verdict always has QUORUM correct voters to share with.
    if (by_committee) {
        let share = reward.value() / correct_voters.length();
        correct_voters.do!(|voter| {
            transfer::public_transfer(coin::from_balance(reward.split(share), ctx), voter);
        });
    };
    reward
}

// === Helpers ===

/// Takes half of `who`'s stake, refunds the rest, removes it from the pool. Returns the half taken.
fun slash_and_remove(pool: &mut Pool, who: address, ctx: &mut TxContext): Balance<SUI> {
    let mut stake = remove(pool, who);
    let half = stake.value() / 2;
    let slashed = stake.split(half);
    event::emit(VerifierSlashed { verifier: who, amount: slashed.value() });
    transfer::public_transfer(coin::from_balance(stake, ctx), who);
    slashed
}

fun remove(pool: &mut Pool, who: address): Balance<SUI> {
    let Verifier { stake, open_duties: _ } = pool.verifiers.remove(who);
    let (_, index) = pool.members.index_of(&who);
    pool.members.swap_remove(index);
    stake
}

// === Reads ===

/// Drawn verifiers (empty until drawn).
public fun committee(dispute: &Dispute): &vector<address> { &dispute.committee }

public fun deadline_ms(dispute: &Dispute): u64 { dispute.deadline_ms }
