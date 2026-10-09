# woia-financial-ledger

Native thin Agent Plugin 1.0.0, version 0.5.7. Source-grounded implementation of WOIA Real Estate Financial Ledger ownership: Charges, immutable factual corrections and ChargeAdjustments, sourced cutover openings, atomic balanced journals, eligible Allocation and compensation, scoped balances/statements.

## Consumer entry

Start at [SKILL.md](skills/woia-financial-ledger/SKILL.md), load the [financial contract](skills/woia-financial-ledger/references/CONTRACT.md) for monetary/authority/persistence work, and import [ledger.mjs](skills/woia-financial-ledger/scripts/ledger.mjs). `executeLedger(port, command)` requires trusted current authority/source resolution and a qualified atomic fenced persistence port. The provider does not select a DBMS or supply a qualified production adapter. `planLedger` is the immutable deterministic transaction planner; it does not make volatile state durable.

Monetary values are string minor units with explicit currency, scale and accepted rounding. Finance-only monetary mutations require exact scoped grants and current versioned policy. Waiver/concession creates ChargeAdjustment with exact independent competent approval; factual corrections never rewrite the original. Allocation consumes accepted eligible credit within beneficiary/custody/purpose/currency and hold constraints; it never creates money. Posted entries remain immutable, and compensations preserve history.

## Support and boundaries

All ten specified operations have deterministic kernel paths and synthetic regression coverage. Physical data boundary, private policy resolver, actual Payments/source binding, real transactional concurrency qualification and cross-provider production integration remain NOT_RUN. No payments, external contact, fee policy, account structure, legal opinion, settlement calculator or authority service is introduced. No Operator E2E, fresh G6/G7 or Production Ready is claimed.

## Authoring

Use the frozen Node 24.21.0 / pnpm 11.19.0 toolchain through mise. `mise run bootstrap`, `mise run doctor`, and `mise run ci:fast` validate local authoring. Ecosystem v0.5.7 `plugin:certify-thin --repo <path>` certifies the clean committed candidate. Tests/maintenance tooling are excluded from portable archives; capability scripts, reference contract, command schema and `dev.woia/manifest.json` remain portable. See repository VALIDATION.md for qualification limits.

## Maintenance

Edit only this canonical repository. Keep `plugin.json`, `package.json` and `dev.woia/manifest.json` versions aligned. From the canonical WOIA Ecosystem repository, run `mise run plugin:certify-thin --repo <absolute-plugin-repository>`, then use its release preparation/publication tasks. Install and update consumers from immutable published artifacts; keep Project personalization in overlays.
