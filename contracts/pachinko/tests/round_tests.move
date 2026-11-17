#[test_only]
module pachinko::round_tests;

use pachinko::round::{Self, AdminCap, Game, Round};
use pachinko::test_helpers::{Self, admin};
use std::unit_test::assert_eq;
use sui::test_scenario as ts;

const PLAYER: address = @0xB0B;
const BET: u64 = 1_000;

// Status values from docs/SPEC.md §7.
const BET_LOCKED: u8 = 0;
const SEEDED: u8 = 1;

#[test]
fun create_round_locks_bet_with_sequential_ids() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::create_round(&mut scenario, PLAYER, BET);

    scenario.next_tx(PLAYER);
    let round = scenario.take_shared<Round>();
    assert_eq!(round.round_id(), 2);
    assert_eq!(round.player(), PLAYER);
    assert_eq!(round.status(), BET_LOCKED);
    assert!(round.seed().is_empty());
    assert_eq!(*round.config_version(), b"pachinko-v0.1.0".to_string());
    ts::return_shared(round);
    scenario.end();
}

#[test]
fun draw_seed_stores_32_bytes() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::draw_seed(&mut scenario, PLAYER);

    scenario.next_tx(PLAYER);
    let round = scenario.take_shared<Round>();
    assert_eq!(round.status(), SEEDED);
    assert_eq!(round.seed().length(), 32);
    ts::return_shared(round);
    scenario.end();
}

#[test]
fun new_rounds_use_updated_config_version() {
    let mut scenario = test_helpers::begin();
    scenario.next_tx(admin());
    let cap = scenario.take_from_sender<AdminCap>();
    let mut game = scenario.take_shared<Game>();
    round::set_config_version(&cap, &mut game, b"pachinko-v0.2.0".to_string());
    ts::return_shared(game);
    scenario.return_to_sender(cap);

    test_helpers::create_round(&mut scenario, PLAYER, BET);
    scenario.next_tx(PLAYER);
    let round = scenario.take_shared<Round>();
    assert_eq!(*round.config_version(), b"pachinko-v0.2.0".to_string());
    ts::return_shared(round);
    scenario.end();
}

#[test, expected_failure(abort_code = round::EZeroBet)]
fun zero_bet_aborts() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, 0);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ESeedAlreadyDrawn)]
fun drawing_seed_twice_aborts() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::draw_seed(&mut scenario, PLAYER);
    test_helpers::draw_seed(&mut scenario, PLAYER);
    scenario.end();
}
