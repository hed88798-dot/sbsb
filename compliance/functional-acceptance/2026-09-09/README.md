# V1 Functional Acceptance Governance Reconciliation

This directory publishes the V3 benchmark authority and the V1 governance
reconciliation for Code C. `FINAL_FUNCTIONAL_ACCEPTANCE_AUTHORITY_SET_V3.json`
is the only active authority for V1 acceptance decisions. The 2026-09-05 V1
and V2 aggregate records remain immutable historical records and are
superseded for current decisions.

The V3 evidence files under `v3/evidence/` are copied byte-for-byte from the
Windows run. Their hashes are recorded in
`v3/GOLDEN_BENCHMARK_V3_AUTHORITY.json`; no media assets are stored in Git.
The benchmark uses direct UTF-8 bytes through `System.Diagnostics.Process`,
evaluates Unique Asset Top5 while retaining Shot as the index unit, and binds
the GQ006 (`猪喝水`) automated result to the manual first-four comparison.

The V1 scope is 100 authorized real assets (100/100 indexed, 103 shots), 40
canonical queries, three independent formulations, 120 searches, and zero
search errors. The historical 500-asset, 100-canonical-query, and universal
Recall@5 >= 0.90 gates are superseded for this V1 acceptance and must not be
represented as passed. All five observed metrics remain recorded as an
empirical baseline; future automatic thresholds require a new version and a
prospective owner decision.

The functional validation Worker is not a release candidate. Native, license,
SBOM/NOTICE, vulnerability, and final-distribution gates must be rerun if the
Worker is ever promoted for distribution. The Code C closeout commit is
recorded as owner-supplied, but remote publication access is currently
blocked; this is an access blocker, not a reason to rerun the benchmark.
