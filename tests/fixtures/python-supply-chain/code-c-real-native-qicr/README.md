# Code C real native QICR fixture

`evidence.json` is a path-normalized, manifest/hash-level fixture derived from GitHub Actions run `33239833877`, artifact `9711035665`, at Code C commit `2fb7eefb5f5ea7d2b260dd9fd6f7559235239eea`.

It preserves all 117 selected, materialized and final logical native records, all 32 symlink metadata records, 15 legacy missing records, 11 approved system build-runtime records, immutable raw-evidence hashes and build-context inputs. Runner absolute paths are replaced by provenance-relative paths. The 118 MB worker binary is deliberately not committed; its worker and CArchive SHA-256 identities are retained.

The approved wheel/CPython universe remains bound by the two wheel-inventory hashes and the locked CPython distribution hash. Its machine count is 70 wheel entries plus 81 CPython entries. The fixture does not falsely assert that the 15 legacy records equal the entire approved-minus-selected relation.
