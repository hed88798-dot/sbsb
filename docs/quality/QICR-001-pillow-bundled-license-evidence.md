# QICR-001: Pillow Bundled License Evidence Contract

- Status: Resolved in the Code F MIT-CMU policy PR
- Owner: Code F / Quality, Release & Compliance
- Trigger: mandatory stop during Pillow 12.3.0 cp313 wheel inspection
- Scope: shared license evidence, policy evaluation, SBOM and notice materialization

## Finding

The Windows and Linux wheels both declare `License-Expression: MIT-CMU`, but their
distributed `pillow-12.3.0.dist-info/licenses/LICENSE` files also contain third-party
license sections. The Linux artifact additionally contains separately packaged shared
libraries. The two wheels have different bytes, license-evidence hashes, component sets,
and native payloads. Treating every wheel byte as MIT-CMU would be false.

The existing Artifact License Evidence v1 could bind the top-level expression and a
hashed license file, but it could not represent and independently gate the discovered
component sections. Code C therefore remained frozen while this shared contract was
changed; no Pillow evidence, Python dependency graph, native-owner schema, or PR #8 code
was modified.

## Resolution

Bundled License Evidence v1 is an additive shared contract. Its offline scanner binds:

- the exact wheel SHA-256, archive inventory, METADATA and source provenance;
- every license/notice evidence file and both raw and normalized hashes;
- native payload paths and SHA-256 values;
- every reviewed component section without replacing uncertain expressions with a more
  convenient SPDX identifier.

The commercial policy contains separate artifact-bound bundled reviews for the two exact
wheel hashes. These records do not expand the global SPDX allowlist. A changed artifact,
component set, evidence hash, or policy identity fails closed. `LicenseRef` entries remain
artifact facts resolved only by the exact reviewed license bundle; they are not generic
automatic approvals.

SBOM output keeps each bundled component separate from Pillow and retains its recorded
expression. Release notice assembly materializes the complete distributed license bundle
and binds every entry back to the containing artifact and evidence hash.

## Compatibility

This is not a breaking change to Python Artifact Inventory v1/v2, Packaged Native
Inventory v2, Toolchain Inventory v1, or License Artifact Evidence v1. It introduces a
new optional evidence input and additive report properties. Existing consumers continue
to operate; release assembly opts into the bundled scan and must do so when the exact
wheel is distributed.
