# R1B Final Baseline

This record closes the accepted R1B product-render baseline. It is provenance only and does not modify R1B implementation or authority.

```text
FINAL_MAIN:
983ac85ae1c49f5b715c9306d15ba9e28414825b

ACCEPTED_R1B_HEAD:
6da0b8a8e495dd1f17cebc7271c1d53d8217c236

WINDOWS_PRODUCT_EVIDENCE_ROOT:
C:\r1b-i04

SUCCESS_OUTPUT_SHA256:
72134e5e990ce294ccb55853a5b8c65fcbff2471dd0075c865875c7aca43817d

SUCCESS_RECEIPT_HASH:
636610e612f0ea38a743087c332edc46a2acb6cef155a3bd0897469dc141c0ab

CANCELLATION_RECEIPT_HASH:
3daee8e90559c37229f7341fe91d47184bbe62db25a31d9ba547cf08edd01bd51

POST_MERGE_CI_RUN:
34981299771

R1B_STATUS:
CLOSED
```

No further R1B implementation work is pending. `C:\r1b-i01` through `C:\r1b-i04` are immutable historical evidence and are not copied into Git. Later packaging, IPC, or UI work must not rerun product-render acceptance merely because distribution wiring changes. All subsequent work starts from `main@983ac85ae1c49f5b715c9306d15ba9e28414825b` or one of its descendants.
