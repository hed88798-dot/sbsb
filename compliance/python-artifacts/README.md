# Python/native artifact inventories

New approved inventories use
`schemas/compliance/python-artifact-inventory/v2/inventory.schema.json`. Schema v2 separates the actual target
environment and its materialized compatible tag set from every wheel's real filename-derived tag set. A wheel
is accepted only when those sets intersect. Keep one file per scope and target environment; do not combine
Windows and Linux targets or production and export packages.

Schema v1 remains readable with its original exact-triple semantics and is deprecated for new intake. It is not
silently reinterpreted. Migrate with `pnpm compliance:python:migrate:v2 -- --inventory <v1> --target-descriptor
<target> --output <v2>`. Generate a real target descriptor on Windows/Linux with `pnpm
compliance:python:target -- describe-current --output <target>`; formal inventories reject synthetic target tag
sources. Target runners revalidate committed `packaging.tags.sys_tags()` evidence.

The directory intentionally contains no approved Python artifacts on the current `main` baseline. Code owners
add reviewed inventory JSON in a normal PR. CI verifies committed inventories and never writes or updates them.
Wheel bytes are retrieved into controlled CI artifact storage from the exact `provenance.download_url`, then
verified against the committed SHA-256 before inspection or installation.

Production inventories accept wheels only. An sdist, VCS URL, floating URL, missing hash, incomplete dependency
graph, undeclared wheel, undeclared native library, or `torch`/`transformers` in the production worker scope
fails closed.

`pnpm compliance:python:candidate -- ...` is the only generation path. It inspects actual wheel metadata and
hashes but deliberately writes `graph_complete: false`, `review_status: PENDING`, and unresolved packaged
paths. The owner must review and edit the candidate in a normal PR. Workflows invoke only verification commands
and never run candidate generation.

Compatibility Engine v1 is locked to `packaging==25.0` and the public `packaging.tags` /
`packaging.utils.parse_wheel_filename` APIs. Its exact upstream wheel, SHA-256, three license files, provenance,
scope and OSV status are recorded in `compliance/quality-tooling/python/packaging-25.0.lock.json`. Candidate,
migration and verifier use the same engine wrapper. Approved inventories can generate an exact URL/hash install
lock with `pnpm compliance:python:require-hashes`; installation must use `--require-hashes --no-deps`.
