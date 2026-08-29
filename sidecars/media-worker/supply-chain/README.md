# Media worker Python supply chain

The approved dependency definitions in `dependency-definitions.json` are the only hand-maintained
package-selection input. They declare direct dependencies and selected extras once; Windows and Linux
closures are calculated independently from the exact wheel `METADATA` on the real target.

## Explicit candidate generation

Candidate refresh is intentionally not part of pull-request CI. Dispatch the manual
`Python supply-chain candidate generation` workflow. Each target job:

1. uses a bootstrap interpreter only to download the locked CPython distribution;
2. verifies the distribution, installer entry, and interpreter payload hashes before installing the exact
   `actions/python-versions` CPython 3.13.15 artifact;
3. attests the installed interpreter as standard-GIL `cp313` from its real `sys_tags` and runner identity;
4. creates a venv without pip and extracts the hash-locked pip 26.2.1 wheel into it;
5. resolves markers and extras from exact wheel metadata using the shared packaging 25.0 engine;
6. downloads binary wheels only from the approved PyPI index and records their canonical artifact URLs;
7. installs and reconciles the candidate runtime/build graph with `--require-hashes`;
8. builds the real PyInstaller one-file worker and inspects its CArchive;
9. fails if any wheel-native byte is absent or any embedded native byte has no exact wheel/CPython owner.

The uploaded candidates remain `PENDING` and `graph_complete: false`. They are deliberately rejected by
ordinary CI.

## Approval

An owner downloads both target bundles, reviews the graph, provenance, license evidence, native mapping,
and diff, then runs:

```text
pnpm code-c:python:candidate:approve -- --target <windows|linux> --bundle <bundle> --artifact-root <approved-artifact-root> --reviewed-at <ISO-8601>

pnpm code-c:python:toolchain:approve -- --target <windows|linux> --bundle <bundle> --artifact-root <approved-toolchain-root> --reviewed-at <ISO-8601> --vulnerability-review <hash-bound-review.json>
```

Approval writes only shared F-contract manifests: Python Artifact Inventory v2 and Toolchain Artifact
Inventory v1. It also writes exact `--require-hashes` locks. Any unknown license, unresolved advisory,
candidate drift, missing CArchive native, or artifact hash mismatch stops approval.

License approval consumes exact upstream wheel metadata and shared Code F evidence. PyInstaller's legacy
metadata description is bound to the exact public Artifact License Evidence v2 scan and remains subject to
the dynamic worker-build Usage Binding v1 evaluation. Code C has no private license-decision schema or
allowlist.

## Ordinary CI

Ordinary Linux and Windows jobs hydrate only the exact URLs already present in approved manifests, verify
every byte and metadata edge, install with the pinned pip wheel and committed hash locks, then build and
reconcile the final worker. Build Provenance, PyInstaller usage binding, license/vulnerability reports, SBOM,
packaged-native reconciliation, and `THIRD_PARTY_NOTICES` are regenerated for each actual build. Ordinary CI
never invokes candidate generation or rewrites inventories.

`pip-hermetic.conf` is the only accepted pip configuration. User config, extra indexes, mirrors, arbitrary
local inputs, VCS references, floating URLs, sdists, cache-source substitutions, and wrong hashes are
negative controls and fail closed.
