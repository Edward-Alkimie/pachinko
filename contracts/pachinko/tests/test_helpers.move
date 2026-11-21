/// Shared setup for the package's tests.
#[test_only]
module pachinko::test_helpers;

use pachinko::round::{Self, Game, Round};
use sui::clock::Clock;
use sui::coin;
use sui::random::Random;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const ADMIN: address = @0xAD;

/// Address that publishes the package and holds the `AdminCap`.
public fun admin(): address { ADMIN }

/// Scenario with `Clock`, a ready `Random`, and the package initialised by `admin()`.
public fun begin(): Scenario {
    let mut scenario = ts::begin(ADMIN);
    scenario.create_system_objects();

    scenario.next_tx(@0x0);
    let mut random = scenario.take_shared<Random>();
    random.update_randomness_state_for_testing(
        0,
        x"1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100",
        scenario.ctx(),
    );
    ts::return_shared(random);

    scenario.next_tx(ADMIN);
    round::init_for_testing(scenario.ctx());
    scenario
}

/// `player` creates a round with a `bet`-MIST stake.
public fun create_round(scenario: &mut Scenario, player: address, bet: u64) {
    scenario.next_tx(player);
    let mut game = scenario.take_shared<Game>();
    round::create_round(&mut game, coin::mint_for_testing<SUI>(bet, scenario.ctx()), scenario.ctx());
    ts::return_shared(game);
}

/// `caller` draws the seed of the most recently created round.
public fun draw_seed(scenario: &mut Scenario, caller: address) {
    scenario.next_tx(caller);
    let mut round = scenario.take_shared<Round>();
    let random = scenario.take_shared<Random>();
    let clock = scenario.take_shared<Clock>();
    round.draw_seed(&random, &clock, scenario.ctx());
    ts::return_shared(clock);
    ts::return_shared(random);
    ts::return_shared(round);
}

/// Moves the shared clock forward by `ms`.
public fun advance_clock(scenario: &mut Scenario, ms: u64) {
    scenario.next_tx(ADMIN);
    let mut clock = scenario.take_shared<Clock>();
    clock.increment_for_testing(ms);
    ts::return_shared(clock);
}
