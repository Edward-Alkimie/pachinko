#[test_only]
module pachinko::round_tests;

use pachinko::round::{Self, AdminCap, Game, Round};
use pachinko::test_helpers::{Self, admin};
use std::unit_test::assert_eq;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const PLAYER: address = @0xB0B;
const BET: u64 = 1_000;

// Status values from docs/SPEC.md §7.
const BET_LOCKED: u8 = 0;
const SEEDED: u8 = 1;
const REFUNDED: u8 = 5;

/// `round::INITIAL_SUBMIT_WINDOW_MS`.
const SUBMIT_WINDOW_MS: u64 = 120_000;

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

// === Refund when no result is submitted ===

fun refund(scenario: &mut Scenario) {
    scenario.next_tx(@0xA11CE); // anyone may call it
    let mut round = scenario.take_shared<Round>();
    let clock = scenario.take_shared<Clock>();
    round.refund_unsubmitted(&clock, scenario.ctx());
    ts::return_shared(clock);
    ts::return_shared(round);
}

#[test]
fun draw_seed_starts_the_submit_window() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::advance_clock(&mut scenario, 5_000);
    test_helpers::draw_seed(&mut scenario, PLAYER);

    scenario.next_tx(PLAYER);
    let round = scenario.take_shared<Round>();
    assert_eq!(round.submit_deadline_ms(), 5_000 + SUBMIT_WINDOW_MS);
    ts::return_shared(round);
    scenario.end();
}

#[test]
fun unsubmitted_round_refunds_the_player_after_the_window() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::draw_seed(&mut scenario, PLAYER);
    test_helpers::advance_clock(&mut scenario, SUBMIT_WINDOW_MS);
    refund(&mut scenario);

    scenario.next_tx(PLAYER);
    let round = scenario.take_shared<Round>();
    assert_eq!(round.status(), REFUNDED);
    ts::return_shared(round);
    let coin = scenario.take_from_sender<Coin<SUI>>();
    assert_eq!(coin.value(), BET);
    scenario.return_to_sender(coin);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ESubmitWindowOpen)]
fun refund_before_the_window_ends_aborts() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::draw_seed(&mut scenario, PLAYER);
    test_helpers::advance_clock(&mut scenario, SUBMIT_WINDOW_MS - 1);
    refund(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotSeeded)]
fun refund_before_the_seed_aborts() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    refund(&mut scenario);
    scenario.end();
}

#[test, expected_failure(abort_code = round::ENotSeeded)]
fun refunding_twice_aborts() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET);
    test_helpers::draw_seed(&mut scenario, PLAYER);
    test_helpers::advance_clock(&mut scenario, SUBMIT_WINDOW_MS);
    refund(&mut scenario);
    refund(&mut scenario);
    scenario.end();
}

#[test]
fun new_rounds_use_updated_submit_window() {
    let mut scenario = test_helpers::begin();
    test_helpers::create_round(&mut scenario, PLAYER, BET); // keeps the old window
    scenario.next_tx(admin());
    let cap = scenario.take_from_sender<AdminCap>();
    let mut game = scenario.take_shared<Game>();
    round::set_submit_window(&cap, &mut game, 1_000);
    ts::return_shared(game);
    scenario.return_to_sender(cap);

    test_helpers::draw_seed(&mut scenario, PLAYER);
    scenario.next_tx(PLAYER);
    let round = scenario.take_shared<Round>();
    assert_eq!(round.submit_deadline_ms(), SUBMIT_WINDOW_MS);
    ts::return_shared(round);
    scenario.end();
}

#[test, expected_failure(abort_code = round::EZeroSubmitWindow)]
fun zero_submit_window_aborts() {
    let mut scenario = test_helpers::begin();
    scenario.next_tx(admin());
    let cap = scenario.take_from_sender<AdminCap>();
    let mut game = scenario.take_shared<Game>();
    round::set_submit_window(&cap, &mut game, 0);
    ts::return_shared(game);
    scenario.return_to_sender(cap);
    scenario.end();
}
