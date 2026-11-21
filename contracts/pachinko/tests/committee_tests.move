/// Pool bookkeeping across disputes that share verifiers (the tally itself is covered end to end
/// in verification_tests).
#[test_only]
module pachinko::committee_tests;

use pachinko::committee;
use std::unit_test::{assert_eq, destroy};
use sui::balance;
use sui::random;
use sui::sui::SUI;
use sui::test_scenario as ts;

const STAKE: u64 = 1_000;
const DEADLINE_MS: u64 = 100;

fun verifiers(): vector<address> { vector[@0x51, @0x52, @0x53] }

#[test]
fun disputes_settle_after_a_shared_verifier_was_slashed_elsewhere() {
    let mut scenario = ts::begin(@0xAD);
    let mut pool = committee::new_pool(STAKE, scenario.ctx());
    verifiers().do!(|v| pool.join(v, balance::create_for_testing<SUI>(STAKE)));

    // A pool of exactly 3: all three disputes draw the same three verifiers.
    let mut rng = random::new_generator_for_testing();
    let mut first = committee::new_dispute(DEADLINE_MS, vector[]);
    let mut second = committee::new_dispute(DEADLINE_MS, vector[]);
    let mut third = committee::new_dispute(DEADLINE_MS, vector[]);
    let drawn = first.draw(&mut pool, &mut rng, 0);
    second.draw(&mut pool, &mut rng, 0);
    third.draw(&mut pool, &mut rng, 0);
    let right = b"right";

    // First: drawn[1] votes against the majority and is slashed out of the pool.
    assert!(!first.record_vote(drawn[0], right, 0));
    assert!(!first.record_vote(drawn[1], b"wrong", 0));
    assert!(first.record_vote(drawn[2], right, 0));
    first.settle(&mut pool, &right, true, balance::zero(), scenario.ctx()).destroy_for_testing();
    assert!(!pool.members().contains(&drawn[1]));

    // Second: settles although drawn[1], still listed, is no longer in the pool.
    assert!(!second.record_vote(drawn[0], right, 0));
    assert!(second.record_vote(drawn[2], right, 0));
    second.settle(&mut pool, &right, true, balance::zero(), scenario.ctx()).destroy_for_testing();

    // Third: drawn[1] has rejoined with no duties; freeing it from this old dispute must not underflow.
    pool.join(drawn[1], balance::create_for_testing<SUI>(STAKE));
    assert!(!third.record_vote(drawn[0], right, 0));
    assert!(third.record_vote(drawn[2], right, 0));
    third.settle(&mut pool, &right, true, balance::zero(), scenario.ctx()).destroy_for_testing();

    // Everyone is free to leave with their stake.
    verifiers().do!(|v| assert_eq!(pool.leave(v).destroy_for_testing(), STAKE));
    destroy(pool);
    scenario.end();
}
