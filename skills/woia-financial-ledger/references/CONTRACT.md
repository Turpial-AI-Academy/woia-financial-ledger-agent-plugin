# Financial Ledger contract

Load this reference before any monetary mutation, authority/persistence design, correction, adjustment or Allocation review.

Source: WOIA Real Estate `eb0a7278188b2f9968e21ed4299f08184d864cac`, docs/21, docs/22, docs/24, ADR-0026/0027/0029, docs/25/ADR-0030 and B5/spec-backlog. This native thin provider owns obligations, allocations and journal facts. Payments owns accepted Payment and outbound money Effects; no external-person notification is performed here. Finance alone mutates monetary truth. Scoped reads require exact current grants.

## Execution API

Import `executeLedger(port, command)` from [ledger.mjs](../scripts/ledger.mjs). A command has `action`, `org_id`, `scope_id`, unique `id`, stable `operation_key`, `expected_revision` and action-specific `payload`. Every monetary payload supplies `scope`: organization, monetary writer scope, currency, integer scale, beneficiary reference, custody reference and purpose. Amounts are canonical strings of minor units; never floats. `decimalToMinor` accepts an explicit organization-approved rounding mode (`REJECT`, `DOWN`, `HALF_UP`, `HALF_EVEN`), not a currency default. Currency/scale/account definitions are external accepted resources.

Trusted ports provide current time, organization/scoped snapshot, current authority and source resolution, and one atomic fenced compare-and-swap. Do not construct authority or source from command claims. The resolved authority requires authenticated actor/current Task, exact provider/action/material command digest, current policy version/digest/window, no hold/conflict/revocation/emergency stop, aggregate-limit evaluation, expected revision and writer fence. Finance is required for every mutation. Adjustment and policy-required approvals bind competent independent human, digest, current policy and validity window. Missing values fail closed. Caller policy resolution must validate represented principal, Mandate powers, exact recipient/counterparty, monetary/aggregate limits, current source map, approval source/revision/conditions and eligible purposes. The kernel binds this result to the entire command; it cannot invent or authenticate those private resources.

At commit, the qualified atomic port must recheck all current authority/source preconditions, writer fence, source revisions and eligible funds under its transaction before publishing the entire new state and stable operation receipt. This protects races between resolution and commit. It must reject partial commits and stale/revoked authority. Single writer per monetary scope and source-credit ownership are mandatory. No production DBMS or adapter is selected or qualified. The pure kernel is not durable storage by itself. Independent adapters must prove transactional isolation and source-credit coordination before publication/readiness.

## Facts and action payloads

| Action | Payload and result |
|---|---|
| `finance.charge.create` | `amount`, `source_contract_ref`, `source_business_key`, `debtor_ref`, `concept`, `period`, scope; source/business-key dedupe prevents duplicate obligations |
| `finance.charge.correct` | `charge_id`, `new_amount`, `expected_charge_revision`, `factual_error=true`, `reason`, scope; immutable factual correction record, original preserved |
| `finance.charge.adjust` | `charge_id`, signed `delta`, `kind`, `factual_error=false`, `reason`, `occurred_at`, `effective_at`, scope; immutable ChargeAdjustment with exact human approval; no factual-error disguise or Payment reversal |
| `finance.opening-position.record` | `cutover_id`, `position_type`, signed `amount`, `effective_cutoff`, `recorded_through`, `reconciliation_status=ACCEPTED`, scope; sourced opening fact without invented Payments/Allocations |
| `finance.journal.post` | `source_fact_ref`, entries; entries contain `account_ref`, `side=DEBIT/CREDIT`, positive amount and identical full scope; immutable atomic balanced journal |
| `finance.journal.compensate` | `journal_id`, reason, scope; immutable exact opposite entries, original retained, duplicate compensation denied |
| `finance.allocation.apply` | `charge_id`, `credit_id`, `credit_revision`, amount, scope; trusted source credit must be accepted Payment/EligibleCredit, match exact scope, have no hold and designate eligible Charge; outstanding debt and available credit enforced |
| `finance.allocation.reverse` | `allocation_id`, amount, reason, scope; partial/full compensation, never deleting original or inventing cash |
| `finance.balance.read` | `account_ref`, scope; exact signed debit-minus-credit journal balance; this is an account balance, not invented settlement calculation |
| `finance.statement.read` | scope grant; immutable scoped fact snapshot including provenance/history, not an externally issued formal settlement |

Every mutation needs trusted accepted source with current authority-map version, evidence, exact command digest, scope and validity interval. Allocations never manufacture Payment; direct-to-beneficiary custody remains explicit. Restricted deposits require eligible purpose, not merely held funds. No cross-owner/currency/custody borrowing. Accepted accounting policy may set `requires_journal=true`: same-command Charge/correction/adjustment/opening/Allocation then requires a balanced `payload.journal` with stable ID, atomically persisted with its fact. No journal configuration is inferred. Residual balances may not go below zero through adjustment/correction/Allocation. Reallocation requires reversal plus separately guarded new Allocation.

Operation-key replay is exact-material idempotency: changed content denied, current authority still rechecked, no new fact. Revision is excluded from material digest to support safe same-operation replay after a successful commit. Consumers must retain durable receipts. No external effects, payment execution, notifications, legal decisions or authority grants exist in this module.

## Qualification boundaries

Synthetic domain tests exercise kernel invariants and atomic-port rejection. Physical storage, organization policy resolver, actual Source Authority bindings, durable concurrency/load qualification and cross-provider production integration remain NOT_RUN. No mock port is advertised as qualified production support. Operator E2E/fresh G6/G7/Production Ready are not claimed. Backend, accounts, fees and organization-private values are deliberately unspecified.
