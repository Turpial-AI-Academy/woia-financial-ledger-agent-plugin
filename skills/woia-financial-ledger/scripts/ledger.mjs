import { createHash } from 'node:crypto';

export const ACTIONS = Object.freeze(['finance.charge.create', 'finance.charge.correct', 'finance.charge.adjust', 'finance.opening-position.record', 'finance.journal.post', 'finance.journal.compensate', 'finance.allocation.apply', 'finance.allocation.reverse', 'finance.balance.read', 'finance.statement.read']);
const fail = (code) => { throw new Error(code); };
const requireThat = (condition, code) => { if (!condition) fail(code); };
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
export const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function commandDigest(command) {
  const { expected_revision, ...material } = command;
  return digest(material);
}
export function minor(value, signed = false) {
  requireThat(typeof value === 'string' && (signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value) && value !== '-0', 'INVALID_EXACT_MONEY');
  return BigInt(value);
}
export function decimalToMinor(value, scale, rounding) {
  requireThat(typeof value === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value), 'INVALID_DECIMAL');
  requireThat(Number.isSafeInteger(scale) && scale >= 0 && scale <= 18, 'INVALID_SCALE');
  requireThat(['REJECT', 'HALF_EVEN', 'HALF_UP', 'DOWN'].includes(rounding), 'ROUNDING_POLICY_REQUIRED');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  let result = BigInt(whole + fraction.slice(0, scale).padEnd(scale, '0'));
  const remainder = fraction.slice(scale);
  if (/[1-9]/.test(remainder)) {
    requireThat(rounding !== 'REJECT', 'INEXACT_AMOUNT');
    const half = '5' + '0'.repeat(Math.max(0, remainder.length - 1));
    if ((rounding === 'HALF_UP' && remainder >= half) || (rounding === 'HALF_EVEN' && (remainder > half || (remainder === half && result % 2n !== 0n)))) result++;
  }
  return ((negative ? -result : result)).toString();
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function emptyLedger(org_id, scope_id) {
  requireThat(text(org_id) && text(scope_id), 'SCOPE_REQUIRED');
  return freeze({ org_id, scope_id, revision: 0, charges: [], corrections: [], adjustments: [], opening_positions: [], journals: [], allocations: [], allocation_compensations: [], operations: [] });
}
const scopeKeys = ['org_id', 'scope_id', 'currency', 'scale', 'beneficiary_ref', 'custody_ref', 'purpose'];
function validateScope(scope) {
  requireThat(scope && scopeKeys.every((key) => key === 'scale' ? Number.isSafeInteger(scope[key]) && scope[key] >= 0 && scope[key] <= 18 : text(scope[key])), 'MONETARY_SCOPE_REQUIRED');
}
function sameScope(a, b) { return Boolean(a && b) && scopeKeys.every((key) => a[key] === b[key]); }
function authorize(command, authority, now) {
  requireThat(Number.isSafeInteger(now), 'CURRENT_TIME_REQUIRED');
  requireThat(authority?.actor?.authenticated === true && text(authority.actor.id) && text(authority.actor.task_id), 'AUTHENTICATED_TASK_REQUIRED');
  requireThat(authority.current === true && authority.org_id === command.org_id && authority.scope_id === command.scope_id && authority.provider === 'woia-financial-ledger', 'AUTHORITY_SCOPE_MISMATCH');
  requireThat(authority.policy?.version && text(authority.policy.digest) && authority.policy.valid_from <= now && now < authority.policy.valid_until && authority.policy.revoked === false && authority.policy.emergency_stop === false, 'CURRENT_POLICY_REQUIRED');
  const mutation = !command.action.endsWith('.read');
  requireThat(!mutation || authority.actor.department === 'Finance', 'FINANCE_ONLY');
  requireThat(authority.grant?.action === command.action && authority.grant.command_digest === commandDigest(command) && authority.grant.revoked === false && authority.grant.valid_from <= now && now < authority.grant.valid_until, 'EXACT_GRANT_REQUIRED');
  requireThat(authority.hold === false && authority.source_conflict === false && authority.aggregate_limit_checked === true, 'HOLD_CONFLICT_OR_LIMIT');
  requireThat(authority.expected_revision === command.expected_revision && text(authority.writer_fence), 'REVISION_FENCE_REQUIRED');
  if (mutation) requireThat(authority.decision === 'POLICY_GOVERNED' || authority.decision === 'APPROVAL_REQUIRED', 'MUTATION_POLICY_REQUIRED');
  if (command.action === 'finance.charge.adjust' || authority.decision === 'APPROVAL_REQUIRED') {
    const approval = authority.approval;
    requireThat(approval?.competent_human === true && text(approval.id) && text(approval.principal) && approval.principal !== authority.actor.id && approval.command_digest === commandDigest(command) && approval.policy_digest === authority.policy.digest && approval.revoked === false && approval.valid_from <= now && now < approval.valid_until, 'EXACT_HUMAN_APPROVAL_REQUIRED');
  }
}
function acceptedSource(command, source, now) {
  requireThat(source?.accepted === true && source.conflict === false && source.org_id === command.org_id && source.scope_id === command.scope_id && source.command_digest === commandDigest(command) && text(source.evidence_ref) && text(source.authority_map_version) && source.valid_from <= now && now < source.valid_until, 'ACCEPTED_FRESH_SOURCE_REQUIRED');
}
function find(items, id, code) { const record = items.find((item) => item.id === id); requireThat(record, code); return record; }
function remainingCharge(state, charge) {
  const correction = state.corrections.filter((item) => item.charge_id === charge.id).at(-1);
  let amount = minor(correction?.new_amount ?? charge.amount);
  for (const adjustment of state.adjustments.filter((item) => item.charge_id === charge.id)) amount += minor(adjustment.delta, true);
  for (const allocation of state.allocations.filter((item) => item.charge_id === charge.id)) amount -= minor(allocation.amount);
  for (const compensation of state.allocation_compensations) {
    if (state.allocations.some((item) => item.id === compensation.allocation_id && item.charge_id === charge.id)) amount += minor(compensation.amount);
  }
  return amount;
}
function journal(payload, scope, id) {
  requireThat(Array.isArray(payload.entries) && payload.entries.length >= 2, 'JOURNAL_ENTRIES_REQUIRED');
  let debits = 0n, credits = 0n;
  for (const entry of payload.entries) {
    requireThat(text(entry.account_ref) && ['DEBIT', 'CREDIT'].includes(entry.side) && sameScope(entry.scope, scope), 'JOURNAL_SCOPE_OR_SIDE');
    const amount = minor(entry.amount); requireThat(amount > 0n, 'POSITIVE_ENTRY_REQUIRED');
    if (entry.side === 'DEBIT') debits += amount; else credits += amount;
  }
  requireThat(debits === credits, 'UNBALANCED_JOURNAL');
  return { id, scope: structuredClone(scope), entries: structuredClone(payload.entries), status: 'POSTED', source_ref: payload.source_ref };
}

/** Pure atomic plan: all validation succeeds before the returned state becomes visible.
 * Sources and authority are resolved by trusted ports, never by a command's own claims. */
export function planLedger(state, command, authority, source, now) {
  requireThat(state && command && ACTIONS.includes(command.action), 'UNKNOWN_ACTION');
  requireThat(command.org_id === state.org_id && command.scope_id === state.scope_id && text(command.operation_key) && text(command.id), 'COMMAND_SCOPE_OR_ID');
  authorize(command, authority, now);
  const hash = commandDigest(command);
  const previous = state.operations.find((item) => item.operation_key === command.operation_key);
  if (previous) { requireThat(previous.digest === hash, 'IDEMPOTENCY_CONFLICT'); return { state, result: previous.result, replay: true, mutated: false }; }
  requireThat(command.expected_revision === state.revision, 'STALE_REVISION');
  const payload = command.payload;
  requireThat(payload && typeof payload === 'object', 'PAYLOAD_REQUIRED');
  if (command.action.endsWith('.read')) {
    const scoped = structuredClone(state);
    if (command.action === 'finance.statement.read') return { state, result: freeze(scoped), mutated: false };
    requireThat(text(payload.account_ref), 'ACCOUNT_REQUIRED');
    validateScope(payload.scope);
    requireThat(payload.scope.org_id === state.org_id && payload.scope.scope_id === state.scope_id, 'READ_SCOPE_MISMATCH');
    let amount = 0n;
    for (const transaction of state.journals) for (const entry of transaction.entries) if (entry.account_ref === payload.account_ref && sameScope(entry.scope, payload.scope)) amount += minor(entry.amount) * (entry.side === 'DEBIT' ? 1n : -1n);
    return { state, result: freeze({ scope: payload.scope, account_ref: payload.account_ref, debit_minus_credit: amount.toString() }), mutated: false };
  }
  acceptedSource(command, source, now);
  const next = structuredClone(state);
  validateScope(payload.scope);
  requireThat(payload.scope.org_id === state.org_id && payload.scope.scope_id === state.scope_id, 'PAYLOAD_SCOPE_MISMATCH');
  requireThat(!Object.values(next).some((items) => Array.isArray(items) && items.some((item) => item.id === command.id)), 'DUPLICATE_ID');
  const base = { ...structuredClone(payload), id: command.id, operation_key: command.operation_key, source_evidence: source.evidence_ref, policy_digest: authority.policy.digest };
  let result;
  switch (command.action) {
    case 'finance.charge.create': {
      requireThat(text(payload.source_contract_ref) && text(payload.source_business_key) && text(payload.debtor_ref) && text(payload.concept) && text(payload.period), 'CHARGE_SOURCE_REQUIRED');
      requireThat(!next.charges.some((item) => item.source_contract_ref === payload.source_contract_ref && item.source_business_key === payload.source_business_key), 'DUPLICATE_SOURCE_FACT');
      requireThat(minor(payload.amount) > 0n, 'POSITIVE_CHARGE_REQUIRED');
      result = base; next.charges.push(result); break;
    }
    case 'finance.charge.correct': {
      const charge = find(next.charges, payload.charge_id, 'CHARGE_NOT_FOUND');
      requireThat(sameScope(charge.scope, payload.scope) && payload.factual_error === true && text(payload.reason), 'FACTUAL_CORRECTION_REQUIRED');
      minor(payload.new_amount);
      requireThat(payload.expected_charge_revision === next.corrections.filter((item) => item.charge_id === charge.id).length, 'STALE_CHARGE_REVISION');
      result = base; next.corrections.push(result);
      requireThat(remainingCharge(next, charge) >= 0n, 'CORRECTION_UNDER_ALLOCATED_BALANCE'); break;
    }
    case 'finance.charge.adjust': {
      const charge = find(next.charges, payload.charge_id, 'CHARGE_NOT_FOUND');
      requireThat(sameScope(charge.scope, payload.scope) && payload.factual_error === false && ['waiver', 'concession', 'agreed-credit', 'accepted-increase', 'accepted-reduction'].includes(payload.kind) && text(payload.reason) && text(payload.effective_at) && text(payload.occurred_at), 'NON_ERROR_ADJUSTMENT_REQUIRED');
      requireThat(minor(payload.delta, true) !== 0n, 'NONZERO_ADJUSTMENT_REQUIRED');
      result = { ...base, approval_ref: authority.approval.id }; next.adjustments.push(result);
      requireThat(remainingCharge(next, charge) >= 0n, 'ADJUSTMENT_UNDER_ALLOCATED_BALANCE'); break;
    }
    case 'finance.opening-position.record': {
      requireThat(text(payload.cutover_id) && text(payload.position_type) && text(payload.effective_cutoff) && text(payload.recorded_through) && payload.reconciliation_status === 'ACCEPTED', 'ACCEPTED_OPENING_REQUIRED');
      minor(payload.amount, true);
      requireThat(!next.opening_positions.some((item) => item.cutover_id === payload.cutover_id && item.position_type === payload.position_type && sameScope(item.scope, payload.scope)), 'DUPLICATE_OPENING_POSITION');
      result = base; next.opening_positions.push(result); break;
    }
    case 'finance.journal.post': {
      requireThat(text(payload.source_fact_ref) && !next.journals.some((item) => item.source_fact_ref === payload.source_fact_ref), 'DUPLICATE_OR_MISSING_JOURNAL_SOURCE');
      result = { ...base, ...journal(payload, payload.scope, command.id) }; next.journals.push(result); break;
    }
    case 'finance.journal.compensate': {
      const original = find(next.journals, payload.journal_id, 'JOURNAL_NOT_FOUND');
      requireThat(sameScope(original.scope, payload.scope) && text(payload.reason), 'COMPENSATION_SCOPE_REQUIRED');
      requireThat(!next.journals.some((item) => item.compensates === original.id), 'ALREADY_COMPENSATED');
      result = { ...base, ...journal({ entries: original.entries.map((item) => ({ ...item, side: item.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' })), source_ref: source.evidence_ref }, payload.scope, command.id), compensates: original.id };
      next.journals.push(result); break;
    }
    case 'finance.allocation.apply': {
      const charge = find(next.charges, payload.charge_id, 'CHARGE_NOT_FOUND');
      const credit = source.credit;
      requireThat(credit?.accepted === true && credit.kind !== 'PaymentObservation' && ['Payment', 'EligibleCredit'].includes(credit.kind) && credit.id === payload.credit_id && sameScope(credit.scope, payload.scope) && sameScope(charge.scope, payload.scope) && credit.hold === false && credit.eligible_charge_id === charge.id && text(credit.revision), 'ACCEPTED_ELIGIBLE_CREDIT_REQUIRED');
      requireThat(payload.credit_revision === credit.revision, 'STALE_CREDIT_REVISION');
      const amount = minor(payload.amount); requireThat(amount > 0n && amount <= remainingCharge(next, charge), 'ALLOCATION_EXCEEDS_CHARGE');
      let consumed = 0n;
      for (const allocation of next.allocations.filter((item) => item.credit_id === credit.id)) consumed += minor(allocation.amount);
      for (const compensation of next.allocation_compensations) if (next.allocations.some((item) => item.id === compensation.allocation_id && item.credit_id === credit.id)) consumed -= minor(compensation.amount);
      requireThat(consumed + amount <= minor(credit.amount), 'INSUFFICIENT_ELIGIBLE_CREDIT');
      result = base; next.allocations.push(result); break;
    }
    case 'finance.allocation.reverse': {
      const original = find(next.allocations, payload.allocation_id, 'ALLOCATION_NOT_FOUND');
      requireThat(sameScope(original.scope, payload.scope) && text(payload.reason), 'ALLOCATION_REVERSAL_SCOPE');
      const amount = minor(payload.amount);
      const reversed = next.allocation_compensations.filter((item) => item.allocation_id === original.id).reduce((sum, item) => sum + minor(item.amount), 0n);
      requireThat(amount > 0n && reversed + amount <= minor(original.amount), 'EXCESS_ALLOCATION_REVERSAL');
      result = base; next.allocation_compensations.push(result); break;
    }
  }
  // Optional accounting requirement is supplied by current policy, not invented by this provider.
  if (authority.requires_journal === true && !command.action.startsWith('finance.journal.')) {
    requireThat(payload.journal && text(payload.journal.id) && !next.journals.some((item) => item.id === payload.journal.id), 'ATOMIC_JOURNAL_REQUIRED');
    next.journals.push({ ...journal(payload.journal, payload.scope, payload.journal.id), source_fact_ref: command.id });
  }
  next.revision++;
  next.operations.push({ operation_key: command.operation_key, digest: hash, result });
  return { state: freeze(next), result: freeze(result), mutated: true, replay: false };
}

/** Qualified adapters must atomically compare revision + current writer fence and persist
 * the entire plan, domain facts and operation receipt. A failed CAS cannot expose any fact.
 * Authority/source ports are trusted current policy resources, not command-supplied claims. */
export async function executeLedger(port, command) {
  requireThat(port && ['read', 'resolveAuthority', 'resolveSource', 'now', 'compareAndSwap'].every((key) => typeof port[key] === 'function'), 'QUALIFIED_ATOMIC_PORT_REQUIRED');
  const state = await port.read(command.org_id, command.scope_id);
  const authority = await port.resolveAuthority(command);
  const now = await port.now();
  const source = command.action.endsWith('.read') ? undefined : await port.resolveSource(command);
  const plan = planLedger(state, command, authority, source, now);
  if (plan.mutated) requireThat(await port.compareAndSwap({ org_id: state.org_id, scope_id: state.scope_id, expected_revision: state.revision, writer_fence: authority.writer_fence, command_digest: commandDigest(command), authority, next: plan.state }), 'ATOMIC_COMMIT_CONFLICT');
  return plan;
}
