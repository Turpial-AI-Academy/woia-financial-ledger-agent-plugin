import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, emptyLedger, planLedger, executeLedger, commandDigest, decimalToMinor, minor } from '../skills/woia-financial-ledger/scripts/ledger.mjs';

const now = 100;
const scope = { org_id: 'synthetic-org', scope_id: 'synthetic-ledger', currency: 'TEST', scale: 2, beneficiary_ref: 'synthetic-beneficiary', custody_ref: 'direct-beneficiary', purpose: 'synthetic-rent' };
const state = () => emptyLedger(scope.org_id, scope.scope_id);
const command = (action = 'finance.charge.create', payload = {}, revision = 0, id = 'charge-1') => ({ action, org_id: scope.org_id, scope_id: scope.scope_id, id, operation_key: 'operation-' + id, expected_revision: revision, payload: { scope: structuredClone(scope), amount: '100', source_contract_ref: 'synthetic-rule-v1', source_business_key: 'lease-period-concept', debtor_ref: 'synthetic-debtor', concept: 'synthetic-rent', period: 'synthetic-period', ...payload } });
const authority = (cmd, extra = {}) => ({ org_id: cmd.org_id, scope_id: cmd.scope_id, provider: 'woia-financial-ledger', current: true, actor: { authenticated: true, id: 'synthetic-actor', task_id: 'synthetic-task', department: 'Finance' }, policy: { version: 'synthetic-v1', digest: 'synthetic-policy-digest', valid_from: 0, valid_until: 200, revoked: false, emergency_stop: false }, grant: { action: cmd.action, command_digest: commandDigest(cmd), revoked: false, valid_from: 0, valid_until: 200 }, hold: false, source_conflict: false, aggregate_limit_checked: true, expected_revision: cmd.expected_revision, writer_fence: 'synthetic-fence', decision: 'POLICY_GOVERNED', ...extra });
const source = (cmd, extra = {}) => ({ accepted: true, conflict: false, org_id: cmd.org_id, scope_id: cmd.scope_id, command_digest: commandDigest(cmd), evidence_ref: 'synthetic-evidence', authority_map_version: 'synthetic-map-v1', valid_from: 0, valid_until: 200, ...extra });
const run = (s, cmd, a = authority(cmd), src = source(cmd)) => planLedger(s, cmd, a, src, now);
const created = () => run(state(), command()).state;
const adjust = () => command('finance.charge.adjust', { charge_id: 'charge-1', delta: '-20', kind: 'waiver', factual_error: false, reason: 'synthetic-human-waiver', occurred_at: 'synthetic-time', effective_at: 'synthetic-time' }, 1, 'adjust-1');
const approval = (cmd) => ({ competent_human: true, id: 'synthetic-approval', principal: 'synthetic-human', command_digest: commandDigest(cmd), policy_digest: 'synthetic-policy-digest', revoked: false, valid_from: 0, valid_until: 200 });
const allocation = (id = 'allocation-1', amount = '60', revision = 1) => command('finance.allocation.apply', { charge_id: 'charge-1', credit_id: 'credit-1', credit_revision: '1', amount }, revision, id);
const credit = (cmd, changes = {}) => source(cmd, { credit: { accepted: true, kind: 'Payment', id: 'credit-1', scope: structuredClone(scope), hold: false, eligible_charge_id: 'charge-1', revision: '1', amount: '100', ...changes } });
const journalCommand = () => command('finance.journal.post', { source_fact_ref: 'fact-1', entries: [{ account_ref: 'synthetic-debit', side: 'DEBIT', amount: '100', scope }, { account_ref: 'synthetic-credit', side: 'CREDIT', amount: '100', scope }] }, 0, 'journal-1');

test('all ten actions are explicit, with no payment/external-contact action', () => { assert.equal(ACTIONS.length, 10); assert.equal(ACTIONS.some((item) => item.startsWith('payment.')), false); });
test('exact decimal conversion and approved rounding never use floating money', () => {
  assert.equal(decimalToMinor('9007199254740993.01', 2, 'REJECT'), '900719925474099301');
  assert.equal(decimalToMinor('1.005', 2, 'HALF_EVEN'), '100');
  assert.equal(decimalToMinor('1.015', 2, 'HALF_EVEN'), '102');
  assert.equal(decimalToMinor('-1.005', 2, 'HALF_UP'), '-101');
  assert.equal(decimalToMinor('-1.009', 2, 'DOWN'), '-100');
  assert.throws(() => decimalToMinor('1.001', 2, 'REJECT'), /INEXACT/);
  assert.throws(() => decimalToMinor('1.00', 2), /ROUNDING_POLICY/);
  assert.throws(() => minor(0.1), /INVALID_EXACT/);
});
test('Charge source/business key uniqueness and immutable original', () => {
  const s = created(); assert.equal(s.charges.length, 1); assert.equal(s.revision, 1);
  assert.throws(() => { s.charges[0].amount = '1'; }, TypeError);
  assert.throws(() => run(s, command('finance.charge.create', {}, 1, 'charge-2')), /DUPLICATE_SOURCE_FACT/);
});
test('same operation replay preserves receipt and no additional fact', () => {
  const cmd = command(); const s = run(state(), cmd).state;
  const replay = run(s, { ...cmd, expected_revision: 1 }); assert.equal(replay.replay, true); assert.equal(replay.state, s); assert.equal(replay.state.charges.length, 1);
  assert.throws(() => run(s, { ...cmd, expected_revision: 1, payload: { ...cmd.payload, amount: '101' } }), /IDEMPOTENCY_CONFLICT/);
});
for (const [label, change, error] of [
  ['department', { actor: { authenticated: true, id: 'other', task_id: 'task', department: 'Sales' } }, /FINANCE_ONLY/],
  ['missing actor', { actor: {} }, /AUTHENTICATED/],
  ['policy', { policy: {} }, /CURRENT_POLICY/],
  ['grant', { grant: {} }, /EXACT_GRANT/],
  ['hold', { hold: true }, /HOLD_CONFLICT/],
  ['aggregate limit', { aggregate_limit_checked: false }, /HOLD_CONFLICT/],
  ['writer fence', { writer_fence: '' }, /REVISION_FENCE/],
  ['stale authority', { current: false }, /AUTHORITY_SCOPE/],
  ['forbidden', { decision: 'FORBIDDEN' }, /MUTATION_POLICY/],
]) test(`deny ${label} before producing monetary state`, () => { const cmd = command(); const s = state(); assert.throws(() => run(s, cmd, authority(cmd, change)), error); assert.equal(s.revision, 0); });
test('expired/revoked grant and emergency stop fail closed even for replay', () => {
  const cmd = command(), s = created(), a = authority(cmd);
  assert.throws(() => run(s, cmd, { ...a, grant: { ...a.grant, revoked: true } }), /EXACT_GRANT/);
  assert.throws(() => run(state(), cmd, { ...a, grant: { ...a.grant, valid_until: now } }), /EXACT_GRANT/);
  assert.throws(() => run(state(), cmd, { ...a, policy: { ...a.policy, emergency_stop: true } }), /CURRENT_POLICY/);
});
test('wrong organization and stale revision cannot mutate', () => {
  assert.throws(() => run(state(), { ...command(), org_id: 'other' }), /COMMAND_SCOPE/);
  assert.throws(() => run(created(), command('finance.charge.create', { source_business_key: 'other' }, 0, 'new')), /STALE_REVISION/);
});
test('unaccepted, conflicting and stale sources cannot become facts', () => {
  const cmd = command(); for (const delta of [{ accepted: false }, { conflict: true }, { valid_until: now }, { authority_map_version: '' }, { command_digest: 'other' }]) assert.throws(() => run(state(), cmd, authority(cmd), source(cmd, delta)), /ACCEPTED_FRESH_SOURCE/);
});
test('factual correction is a new attributable record and original is retained', () => {
  const cmd = command('finance.charge.correct', { charge_id: 'charge-1', new_amount: '120', expected_charge_revision: 0, factual_error: true, reason: 'synthetic-source-error' }, 1, 'correct-1');
  const s = run(created(), cmd).state; assert.equal(s.charges[0].amount, '100'); assert.equal(s.corrections[0].new_amount, '120');
  assert.throws(() => run(created(), { ...cmd, payload: { ...cmd.payload, factual_error: false } }), /FACTUAL_CORRECTION/);
});
test('ChargeAdjustment requires exact independent human approval, preserves original', () => {
  const cmd = adjust(); assert.throws(() => run(created(), cmd), /EXACT_HUMAN/);
  const s = run(created(), cmd, authority(cmd, { approval: approval(cmd) })).state;
  assert.equal(s.charges[0].amount, '100'); assert.equal(s.adjustments[0].delta, '-20'); assert.equal(s.adjustments[0].approval_ref, 'synthetic-approval');
  for (const delta of [{ revoked: true }, { principal: 'synthetic-actor' }, { command_digest: 'changed-amount' }, { valid_until: now }]) assert.throws(() => run(created(), cmd, authority(cmd, { approval: { ...approval(cmd), ...delta } })), /EXACT_HUMAN/);
});
test('adjustment cannot hide factual error or over-reduce obligation', () => {
  for (const delta of [{ factual_error: true }, { delta: '-101' }]) {
    const cmd = { ...adjust(), payload: { ...adjust().payload, ...delta } };
    assert.throws(() => run(created(), cmd, authority(cmd, { approval: approval(cmd) })), /NON_ERROR|UNDER_ALLOCATED/);
  }
});
test('opening positions retain cutover source, never fabricate payment/allocation history', () => {
  const cmd = command('finance.opening-position.record', { amount: '-50', cutover_id: 'cutover-1', position_type: 'synthetic-opening-debt', effective_cutoff: 'synthetic-cutoff', recorded_through: 'synthetic-recorded', reconciliation_status: 'ACCEPTED' }, 0, 'opening-1');
  const s = run(state(), cmd).state; assert.equal(s.opening_positions.length, 1); assert.equal(s.allocations.length, 0); assert.equal(s.journals.length, 0);
  assert.throws(() => run(s, { ...cmd, id: 'opening-2', operation_key: 'other', expected_revision: 1 }), /DUPLICATE_OPENING/);
});
test('journal posts atomically and rejects imbalance/currency/account omission', () => {
  const cmd = journalCommand(), s = state(); const p = run(s, cmd); assert.equal(p.state.journals[0].status, 'POSTED'); assert.equal(s.journals.length, 0);
  for (const delta of [{ amount: '99' }, { scope: { ...scope, currency: 'OTHER' } }, { account_ref: '' }]) {
    const changed = structuredClone(cmd); Object.assign(changed.payload.entries[1], delta);
    assert.throws(() => run(s, changed), /UNBALANCED|JOURNAL_SCOPE/); assert.equal(s.revision, 0);
  }
});
test('journal compensation retains original and forbids double compensation', () => {
  const s = run(state(), journalCommand()).state;
  const cmd = command('finance.journal.compensate', { journal_id: 'journal-1', reason: 'synthetic-reversal' }, 1, 'comp-1');
  const after = run(s, cmd).state; assert.equal(after.journals[0].entries[0].side, 'DEBIT'); assert.equal(after.journals[1].entries[0].side, 'CREDIT');
  assert.throws(() => run(after, { ...cmd, id: 'comp-2', operation_key: 'comp-2', expected_revision: 2 }), /ALREADY_COMPENSATED/);
});
test('Allocation accepts split payment credit and preserves cash boundary', () => {
  const cmd = allocation(); const s = run(created(), cmd, authority(cmd), credit(cmd)).state;
  assert.equal(s.allocations[0].amount, '60'); assert.equal(s.charges[0].amount, '100'); assert.equal('payments' in s, false);
  const second = allocation('allocation-2', '40', 2); const after = run(s, second, authority(second), credit(second)).state; assert.equal(after.allocations.length, 2);
  const excess = allocation('allocation-3', '1', 3); assert.throws(() => run(after, excess, authority(excess), credit(excess)), /EXCEEDS_CHARGE/);
});
test('Observation, hold, foreign beneficiary/currency/custody/purpose cannot fund Allocation', () => {
  const cmd = allocation(); for (const delta of [{ kind: 'PaymentObservation' }, { accepted: false }, { hold: true }, { scope: { ...scope, beneficiary_ref: 'other-owner' } }, { scope: { ...scope, currency: 'OTHER' } }, { scope: { ...scope, custody_ref: 'other' } }, { scope: { ...scope, purpose: 'deposit-held' } }]) assert.throws(() => run(created(), cmd, authority(cmd), credit(cmd, delta)), /ACCEPTED_ELIGIBLE_CREDIT/);
});
test('stale source credit and overconsumption denied', () => {
  const cmd = allocation(); assert.throws(() => run(created(), cmd, authority(cmd), credit(cmd, { revision: '2' })), /STALE_CREDIT/);
  assert.throws(() => run(created(), cmd, authority(cmd), credit(cmd, { amount: '59' })), /INSUFFICIENT_ELIGIBLE/);
});
test('partial reversal is compensation and cannot exceed original', () => {
  const cmd = allocation(); const s = run(created(), cmd, authority(cmd), credit(cmd)).state;
  const reverse = command('finance.allocation.reverse', { allocation_id: 'allocation-1', amount: '30', reason: 'synthetic-partial-reversal' }, 2, 'reverse-1');
  const after = run(s, reverse).state; assert.equal(after.allocations[0].amount, '60'); assert.equal(after.allocation_compensations[0].amount, '30');
  assert.throws(() => run(after, { ...reverse, id: 'reverse-2', operation_key: 'reverse-2', expected_revision: 3, payload: { ...reverse.payload, amount: '31' } }), /EXCESS_ALLOCATION/);
});
test('required journal and Charge commit as one plan or neither', () => {
  const cmd = command(); assert.throws(() => run(state(), cmd, authority(cmd, { requires_journal: true })), /ATOMIC_JOURNAL/);
  const withJournal = command('finance.charge.create', { journal: { id: 'associated-journal', entries: journalCommand().payload.entries } });
  const s = run(state(), withJournal, authority(withJournal, { requires_journal: true })).state; assert.equal(s.charges.length, 1); assert.equal(s.journals.length, 1); assert.equal(s.revision, 1);
});
test('balance/read statement is scoped, immutable, and exact after compensation', () => {
  const s = run(state(), journalCommand()).state;
  const cmd = command('finance.balance.read', { account_ref: 'synthetic-debit' }, 1, 'read-1'); assert.equal(run(s, cmd).result.debit_minus_credit, '100');
  const statement = command('finance.statement.read', {}, 1, 'read-2'); const result = run(s, statement); assert.equal(result.mutated, false); assert.equal(result.result.journals.length, 1); assert.ok(Object.isFrozen(result.result));
});
test('failed atomic persistence CAS never exposes partial mutation', async () => {
  const original = state(), cmd = command(); let commits = 0;
  const port = { read: async () => original, resolveAuthority: async () => authority(cmd), resolveSource: async () => source(cmd), now: () => now, compareAndSwap: async ({ expected_revision, writer_fence, next }) => { commits++; assert.equal(expected_revision, 0); assert.equal(writer_fence, 'synthetic-fence'); assert.equal(next.charges.length, 1); return false; } };
  await assert.rejects(executeLedger(port, cmd), /ATOMIC_COMMIT_CONFLICT/); assert.equal(original.charges.length, 0); assert.equal(commits, 1);
});
test('concurrent same-scope commands allow only one atomic fenced commit', async () => {
  let stored = state();
  const port = { read: async () => stored, resolveAuthority: async (cmd) => authority(cmd), resolveSource: async (cmd) => source(cmd), now: () => now, compareAndSwap: async ({ expected_revision, next }) => { if (stored.revision !== expected_revision) return false; stored = next; return true; } };
  const results = await Promise.allSettled([executeLedger(port, command()), executeLedger(port, command('finance.charge.create', { source_business_key: 'other' }, 0, 'charge-2'))]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); assert.equal(stored.charges.length, 1);
});
