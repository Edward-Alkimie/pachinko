#[test_only]
module pachinko::verification_tests;

use pachinko::round::{Self, AdminCap, Round};
use pachinko::test_helpers::{Self, admin};
use pachinko::verification::{Self, House, OperatorCap};
use std::unit_test::assert_eq;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const PLAYER: address = @0xB0B;
const OPERATOR: address = @0x0FE;
const CHALLENGER: address = @0xC4A1;

const BET: u64 = 1_000;
const HOUSE_FUNDS: u64 = 1_000_000;
const OPERATOR_BOND: u64 = 500;
const CHALLENGER_BOND: u64 = 300;
const WINDOW_MS: u64 = 60_000;
const BALLS: u64 = 4;
const NONE: u16 = 0xFFFF;

// Status value from docs/SPEC.md §7.
const FINALIZED: u8 = 4;

/// Pocket multipliers: 3×, 1×, 0.5×, 0, 0.5×, 1×, 3×.
fun multipliers(): vector<u64> { vector[30_000, 10_000, 5_000, 0, 5_000, 10_000, 30_000] }

/// The result the arbiter confirms: 3× + 0 + 3× + none = 6× over 4 balls → 1.5 × BET.
fun honest_outcomes(): vector<u16> { vector[0, 3, 6, NONE] }

const HONEST_PAYOUT: u64 = 1_500;

/// A forged jackpot: every ball in a 3× pocket.
fun forged_outcomes(): vector<u16> { vector[0, 0, 0, 0] }

// === Scenario steps ===

/// Package, operator cap, funded house, and one seeded round for PLAYER.
fun setup(): Scenario {
    let mut scenario = test_helpers::begin();
    scenario.next_tx(admin());
    let cap = scenario.take_from_sender<AdminCap>();
    verification::issue_operator_cap(&cap, OPERATOR, scenario.ctx());
    verification::create_house(
        &cap,
        multipliers(),
        BALLS,
        OPERATOR_BOND,
        CHALLENGER_BOND,
        WINDOW_MS,
        scenario.ctx(),
    );
    scenario.return_to_sender(cap);

    scenario.next_tx(admin());
    let mut house = scenario.take_shared<House>();
    verification::fund_house(&mut house, coin::mint_for_testing(HOUSE_FUNDS, scenario.ctx()));
    ts::return_shared(house);

    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::draw_seed(&mut scenario, PLAYER);
    scenario
}

/// Hash the round would accept for `outcomes`.
fun hash_for(round: &Round, outcomes: &vector<u16>): vector<u8> {
    verification::result_hash(round.config_version(), round.seed(), round.round_id(), outcomes)
}

/// OPERATOR submits `outcomes` with their correct hash and the right bond.
fun submit(scenario: &mut Scenario, outcomes: vector<u16>) {
    scenario.next_tx(OPERATOR);
    let round = scenario.take_shared<Round>();
    let hash = hash_for(&round, &outcomes);
    ts::return_shared(round);
    submit_raw(scenario, outcomes, hash, OPERATOR_BOND);
}

/// OPERATOR submits exactly what is given.
fun submit_raw(scenario: &mut Scenario, outcomes: vector<u16>, hash: vector<u8>, bond: u64) {
    scenario.next_tx(OPERATOR);
    let cap = scenario.take_from_sender<OperatorCap>();
    let mut round = scenario.take_shared<Round>();
    let house = scenario.take_shared<House>();
    let clock = scenario.take_shared<Clock>();
    verification::submit_result(
        &cap,
        &mut round,
        &house,
        outcomes,
        hash,
        coin::mint_for_testing(bond, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );
    ts::return_shared(clock);
    ts::return_shared(house);
    ts::return_shared(round);
    scenario.return_to_sender(cap);
}

fun challenge(scenario: &mut Scenario) {
    scenario.next_tx(CHALLENGER);
    let mut round = scenario.take_shared<Round>();
    let house = scenario.take_shared<House>();
    let clock = scenario.take_shared<Clock>();
    verification::challenge(
        &mut round,
        &house,
        coin::mint_for_testing(CHALLENGER_BOND, scenario.ctx()),
        &clock,
        scenario.ctx(),
    );
    ts::return_shared(clock);
    ts::return_shared(house);
    ts::return_shared(round);
}

fun advance_clock(scenario: &mut Scenario, ms: u64) {
    scenario.next_tx(admin());
    let mut clock = scenario.take_shared<Clock>();
    clock.increment_for_testing(ms);
    ts::return_shared(clock);
}

fun finalize(scenario: &mut Scenario) {
    scenario.next_tx(PLAYER);
    let mut round = scenario.take_shared<Round>();
    let mut house = scenario.take_shared<House>();
    let clock = scenario.take_shared<Clock>();
    verification::finalize(&mut round, &mut house, &clock, scenario.ctx());
    ts::return_shared(clock);
    ts::return_shared(house);
    ts::return_shared(round);
}

fun resolve(scenario: &mut Scenario, correct_outcomes: vector<u16>) {
    scenario.next_tx(admin());
    let cap = scenario.take_from_sender<AdminCap>();
    let mut round = scenario.take_shared<Round>();
    let mut house = scenario.take_shared<House>();
    verification::resolve_by_admin(&cap, &mut round, &mut house, correct_outcomes, scenario.ctx());
    ts::return_shared(house);
    ts::return_shared(round);
    scenario.return_to_sender(cap);
}

// === Checks ===

/// The most recent coin `owner` received has `value` MIST.
fun assert_received(scenario: &mut Scenario, owner: address, value: u64) {
    scenario.next_tx(owner);
    let coin = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(coin.value(), value);
    scenario.return_to_sender(coin);
}

/// Round is final, stores the honest result, and the house paid exactly `HONEST_PAYOUT`.
fun assert_settled_honestly(scenario: &mut Scenario) {
    scenario.next_tx(admin());
    let round = scenario.take_shared<Round>();
    let house = scenario.take_shared<House>();
    assert_eq!(round.status(), FINALIZED);
    assert_eq!(*verification::submitted_hash(&round), hash_for(&round, &honest_outcomes()));
    assert_eq!(house.treasury_value(), HOUSE_FUNDS + BET - HONEST_PAYOUT);
    ts::return_shared(house);
    ts::return_shared(round);
    assert_received(scenario, PLAYER, HONEST_PAYOUT);
}

// === Result hash matches physics ===

#[test]
fun result_hash_matches_physics_golden_fixture() {
    // docs/SPEC.md §3 golden fixture: seed 000102…1f, round 1, pachinko-v0.1.0.
    let outcomes = vector[
        0, 6, 4, 1, 4, 2, 0, 3, 6, 0, 0, 0, 0, 3, 4, 2, 5, 0, 1, 6,
        2, 6, 1, 6, 4, 0, 6, 3, 1, 0, 3, 2, 3, 2, 4, 0, 5, 3, 3, 0,
        4, 4, 6, 4, 1, 0, 0, 1, 5, 2, 3, 4, 2, 3, 1, 4, 6, 1, 2, 2,
        6, 1, 5, 0, 0, 6, 6, 5, 4, 5, 1, 2, 0, 2, 6, 3, 4, 2, 5, 4,
        3, 0, 1, 5, 0, 1, 6, 1, 2, 5, 2, 4, 5, 1, 5, 6, 4, 4, 2, 0,
    ];
    let hash = verification::result_hash(
        &b"pachinko-v0.1.0".to_string(),
        &x"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        1,
        &outcomes,
    );
    assert_eq!(hash, x"06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151");
}

#[test]
fun result_hash_encodes_unlanded_ball_as_minus_one() {
    // hashRoundResult({ version: 'pachinko-v0.1.0', seed: 000102…1f, roundId: 7n, outcomes: [-1, 0, 6, -1] })
    let hash = verification::result_hash(
        &b"pachinko-v0.1.0".to_string(),
        &x"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        7,
        &vector[NONE, 0, 6, NONE],
    );
    assert_eq!(hash, x"6c21498f89b82ec19ca07eb3d0eacf8eac9667043c96d4ef8c778a262aa1c1f1");
}

// === Full rounds ===

#[test]
fun honest_round_pays_player_and_returns_operator_bond() {
    let mut scenario = setup();
    submit(&mut scenario, honest_outcomes());
    advance_clock(&mut scenario, WINDOW_MS);
    finalize(&mut scenario);

    assert_settled_honestly(&mut scenario);
    assert_received(&mut scenario, OPERATOR, OPERATOR_BOND);
    scenario.end();
}

#[test]
fun forged_result_is_caught_by_challenge() {
    let mut scenario = setup();
    submit(&mut scenario, forged_outcomes());
    challenge(&mut scenario);
    resolve(&mut scenario, honest_outcomes());

    // Player is paid from the correct result, not the forged jackpot.
    assert_settled_honestly(&mut scenario);
    assert_received(&mut scenario, CHALLENGER, CHALLENGER_BOND + OPERATOR_BOND);
    scenario.end();
}

#[test]
fun false_challenge_loses_its_bond() {
    let mut scenario = setup();
    submit(&mut scenario, honest_outcomes());
    challenge(&mut scenario);
    resolve(&mut scenario, honest_outcomes());

    assert_settled_honestly(&mut scenario);
    assert_received(&mut scenario, OPERATOR, OPERATOR_BOND + CHALLENGER_BOND);
    scenario.end();
}

// === Invalid submissions ===

#[test, expected_failure(abort_code = verification::EHashMismatch)]
fun submit_with_wrong_hash_aborts() {
    let mut scenario = setup();
    scenario.next_tx(OPERATOR);
    let round = scenario.take_shared<Round>();
    let other_hash = hash_for(&round, &forged_outcomes());
    ts::return_shared(round);
    submit_raw(&mut scenario, honest_outcomes(), other_hash, OPERATOR_BOND);
    scenario.end();
}

#[test, expected_failure(abort_code = verification::EWrongBallCount)]
fun submit_with_wrong_ball_count_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, vector[0, 1, 2]);
    scenario.end();
}

#[test, expected_failure(abort_code = verification::EInvalidOutcome)]
fun submit_with_unknown_pocket_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, vector[0, 1, 2, 7]);
    scenario.end();
}

#[test, expected_failure(abort_code = verification::EWrongBond)]
fun submit_with_wrong_bond_aborts() {
    let mut scenario = setup();
    scenario.next_tx(OPERATOR);
    let round = scenario.take_shared<Round>();
    let hash = hash_for(&round, &honest_outcomes());
    ts::return_shared(round);
    submit_raw(&mut scenario, honest_outcomes(), hash, OPERATOR_BOND - 1);
    scenario.end();
}

// === Wrong state / wrong time ===

#[test, expected_failure(abort_code = round::ENotSeeded)]
fun submit_before_seed_aborts() {
    let mut scenario = setup();
    test_helpers::create_round(&mut scenario, PLAYER, BET); // newest round has no seed yet
    submit_raw(&mut scenario, honest_outcomes(), vector[], OPERATOR_BOND);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotSeeded)]
fun submitting_twice_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, honest_outcomes());
    submit(&mut scenario, honest_outcomes());
    scenario.end();
}

#[test, expected_failure(abort_code = verification::EWindowClosed)]
fun challenge_after_window_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, forged_outcomes());
    advance_clock(&mut scenario, WINDOW_MS);
    challenge(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotSubmitted)]
fun second_challenge_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, forged_outcomes());
    challenge(&mut scenario);
    challenge(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = verification::EWindowOpen)]
fun finalize_during_window_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, honest_outcomes());
    advance_clock(&mut scenario, WINDOW_MS - 1);
    finalize(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotSubmitted)]
fun finalize_while_challenged_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, forged_outcomes());
    challenge(&mut scenario);
    advance_clock(&mut scenario, WINDOW_MS);
    finalize(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotSubmitted)]
fun finalizing_twice_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, honest_outcomes());
    advance_clock(&mut scenario, WINDOW_MS);
    finalize(&mut scenario);
    finalize(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotChallenged)]
fun resolve_without_challenge_aborts() {
    let mut scenario = setup();
    submit(&mut scenario, honest_outcomes());
    resolve(&mut scenario, honest_outcomes());
    scenario.end();
}

// === Payout ===

#[test, expected_failure(abort_code = verification::EHouseInsolvent)]
fun finalize_aborts_when_house_cannot_pay() {
    let mut scenario = setup();
    scenario.next_tx(admin());
    let cap = scenario.take_from_sender<AdminCap>();
    let mut house = scenario.take_shared<House>();
    verification::withdraw_house(&cap, &mut house, HOUSE_FUNDS, scenario.ctx()).burn_for_testing();
    ts::return_shared(house);
    scenario.return_to_sender(cap);

    submit(&mut scenario, forged_outcomes()); // pays 3 × BET, house only has the bet
    advance_clock(&mut scenario, WINDOW_MS);
    finalize(&mut scenario);
    scenario.end();
}
