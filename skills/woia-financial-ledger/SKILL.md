---
name: woia-financial-ledger
description: Create and correct sourced Charges, record approved ChargeAdjustments and opening positions, post immutable balanced journals, and apply or compensate eligible Allocations under exact Finance authority. Read scoped statements and balances without performing payments or external contact.
license: MIT
---

# Financial Ledger

## Operating flow

DISCOVER -> DECIDE -> IMPLEMENT -> VALIDATE -> REPORT

## Ownership

Finance owns obligations, allocations and journal truth. Payments supplies accepted Payment/eligible credit references; a PaymentObservation is not cash acceptance. Ledger does not execute payouts or external-person communication. Owner Settlement retains its external formal calculator. No department copy or model memory is a monetary master.

## Before execution

Load [CONTRACT.md](references/CONTRACT.md) for any monetary command, persisted-state/authority integration, correction or adjustment. Obtain exact current organization policy, Source Authority, actor/current Task grant, revision and single-writer fence. Missing private configuration blocks the command. Marketplace installation, role, competence and tool access never grant authority.

## Deterministic operations

Use [ledger.mjs](scripts/ledger.mjs), `executeLedger(port, command)`, through a qualified atomic persistence/authority/source port. [command.schema.json](schemas/command.schema.json) describes the public command envelope. No qualified physical adapter is supplied. Pure `planLedger` evaluates immutable snapshots for testing/integration; its successful plan is not durable acceptance until atomic commit succeeds.

- `finance.charge.create`: accepted rule/business-key dedupe.
- `finance.charge.correct`: factual correction only, original retained.
- `finance.charge.adjust`: approved non-error economic change ; immutable ChargeAdjustment, exact independent human approval.
- `finance.opening-position.record`: sourced cutover position without fabricated Payment history.
- `finance.journal.post` / `finance.journal.compensate`: balanced immutable entries or attributable opposite posting.
- `finance.allocation.apply` / `finance.allocation.reverse`: accepted eligible funds only, bounded residual/availability, explicit purpose/beneficiary/custody/holds, compensation preserves original.
- `finance.balance.read` / `finance.statement.read`: exact current scoped read grant.

Use strings of minor monetary units and explicit currency/scale/approved rounding. Do not use floating point, create cash through Allocation, move funds across beneficiaries, hide concessions as corrections or write a LedgerEntry independently. A current policy requiring accounting attaches a same-command balanced journal; do not invent accounts, fees or accounting rules.

## Verification and reporting

Validate exact operation digest, source evidence/freshness, aggregate limits, holds/revocations and expected revision immediately before the atomic consequence. Retain operation receipts; retry only identical operations under current authority. Report candidate identity, persisted versus planned result, evidence/source/policy references and remaining blocker. Tests and pure plans are not physical adapter qualification, Operator E2E, fresh G6/G7 or Production Ready. Preserve unaffected facts; a failed plan/CAS cannot publish a partial financial mutation.
