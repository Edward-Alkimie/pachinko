/// Round module: locks a player's bet, draws the round seed with `sui::random` in a
/// later transaction, and owns the round's status (the state machine).
///
/// Everything after the seed (result, challenge, payout) lives in `verification`, which
/// moves the status only through the `public(package)` transitions at the bottom of this file.
/// Status values and event fields are part of the shared interface: docs/SPEC.md §7.
module pachinko::round;

use std::string::String;
use sui::balance::Balance;
use sui::coin::Coin;
use sui::event;
use sui::random::Random;
use sui::sui::SUI;

// === Statuses ===

const STATUS_BET_LOCKED: u8 = 0;
const STATUS_SEEDED: u8 = 1;
const STATUS_SUBMITTED: u8 = 2;
const STATUS_CHALLENGED: u8 = 3;
const STATUS_FINALIZED: u8 = 4;

// === Errors ===

const EZeroBet: u64 = 0;
const ESeedAlreadyDrawn: u64 = 1;
const ENotSeeded: u64 = 2;
const ENotSubmitted: u64 = 3;
const ENotChallenged: u64 = 4;

// === Constants ===

/// Seed length in bytes (docs/SPEC.md §2).
const SEED_BYTES: u16 = 32;
/// Physics config version for new rounds until the admin changes it (`physics/src/config.ts`).
const INITIAL_CONFIG_VERSION: vector<u8> = b"pachinko-v0.1.0";

// === Objects ===

/// Admin capability for privileged actions in this package.
public struct AdminCap has key, store { id: UID }

/// Shared singleton: hands out round ids and the config version new rounds use.
public struct Game has key {
    id: UID,
    next_round_id: u64,
    config_version: String,
}

/// One pachinko round. Shared so the operator, challengers and the admin can act on it.
public struct Round has key {
    id: UID,
    round_id: u64,
    player: address,
    /// Physics config version the result must be computed with.
    config_version: String,
    /// Empty until `draw_seed`, then 32 bytes.
    seed: vector<u8>,
    /// Locked until the round is finalized.
    bet: Balance<SUI>,
    status: u8,
}

// === Events ===

public struct RoundCreated has copy, drop {
    round: ID,
    round_id: u64,
    player: address,
    bet: u64,
    config_version: String,
}

public struct SeedDrawn has copy, drop {
    round: ID,
    round_id: u64,
    seed: vector<u8>,
}

fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Game {
        id: object::new(ctx),
        next_round_id: 1,
        config_version: INITIAL_CONFIG_VERSION.to_string(),
    });
}

// === Player ===

/// Creates a round for the sender and locks `bet` in it (→ BET_LOCKED).
/// The seed is drawn later, in a separate transaction, so the bet is fixed before anyone knows it.
public fun create_round(game: &mut Game, bet: Coin<SUI>, ctx: &mut TxContext) {
    let amount = bet.value();
    assert!(amount > 0, EZeroBet);

    let round_id = game.next_round_id;
    game.next_round_id = round_id + 1;

    let round = Round {
        id: object::new(ctx),
        round_id,
        player: ctx.sender(),
        config_version: game.config_version,
        seed: vector[],
        bet: bet.into_balance(),
        status: STATUS_BET_LOCKED,
    };
    event::emit(RoundCreated {
        round: object::id(&round),
        round_id,
        player: round.player,
        bet: amount,
        config_version: round.config_version,
    });
    transfer::share_object(round);
}

/// Draws the 32-byte seed from on-chain randomness (BET_LOCKED → SEEDED).
/// Non-public `entry` so no other Move code can call it and abort on a seed it dislikes.
/// Anyone may call it: the bet is already locked and a round cannot be cancelled.
entry fun draw_seed(round: &mut Round, r: &Random, ctx: &mut TxContext) {
    assert!(round.status == STATUS_BET_LOCKED, ESeedAlreadyDrawn);
    let mut generator = r.new_generator(ctx);
    round.seed = generator.generate_bytes(SEED_BYTES);
    round.status = STATUS_SEEDED;
    event::emit(SeedDrawn { round: object::id(round), round_id: round.round_id, seed: round.seed });
}

// === Admin ===

/// Sets the physics config version used by rounds created from now on.
public fun set_config_version(_: &AdminCap, game: &mut Game, version: String) {
    game.config_version = version;
}

// === Reads ===

/// Sequential round id (input to seed derivation and the result hash).
public fun round_id(round: &Round): u64 { round.round_id }

/// Address that placed the bet and receives the payout.
public fun player(round: &Round): address { round.player }

/// Physics config version the result must be computed with.
public fun config_version(round: &Round): &String { &round.config_version }

/// Round seed: empty before `draw_seed`, 32 bytes after.
public fun seed(round: &Round): &vector<u8> { &round.seed }

/// Current status (values in docs/SPEC.md §7).
public fun status(round: &Round): u8 { round.status }

// === Transitions for `verification` ===

/// UID for `verification`'s dynamic field (the submitted result).
public(package) fun uid(round: &Round): &UID { &round.id }

/// Mutable UID for `verification`'s dynamic field (the submitted result).
public(package) fun uid_mut(round: &mut Round): &mut UID { &mut round.id }

/// SEEDED → SUBMITTED.
public(package) fun mark_submitted(round: &mut Round) {
    assert!(round.status == STATUS_SEEDED, ENotSeeded);
    round.status = STATUS_SUBMITTED;
}

/// SUBMITTED → CHALLENGED.
public(package) fun mark_challenged(round: &mut Round) {
    assert!(round.status == STATUS_SUBMITTED, ENotSubmitted);
    round.status = STATUS_CHALLENGED;
}

/// SUBMITTED → FINALIZED (window passed, no challenge). Releases the locked bet.
public(package) fun finalize_unchallenged(round: &mut Round): Balance<SUI> {
    assert!(round.status == STATUS_SUBMITTED, ENotSubmitted);
    round.status = STATUS_FINALIZED;
    round.bet.withdraw_all()
}

/// CHALLENGED → FINALIZED (dispute settled). Releases the locked bet.
public(package) fun finalize_disputed(round: &mut Round): Balance<SUI> {
    assert!(round.status == STATUS_CHALLENGED, ENotChallenged);
    round.status = STATUS_FINALIZED;
    round.bet.withdraw_all()
}

// === Test helpers ===

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
