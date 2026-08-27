# Python/native artifact inventories

Approved inventories use
`schemas/compliance/python-artifact-inventory/v1/inventory.schema.json`. Keep one file per scope and
target platform; do not combine Windows and Linux wheels or production and export packages.

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
