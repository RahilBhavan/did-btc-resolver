# Local v1 scope and acceptance

Agreed 2026-10-21: finish the existing TypeScript did:btc resolver and creator against MicroStrategy's actual upstream draft specification, pinned to a commit and retrieval date. Support single-DID create/read/update/deactivate and version resolution. Run the real lifecycle on isolated Bitcoin Core regtest using mined test coins, never mainnet or money. Preserve offline vectors and label them separately from node-confirmed evidence.

Acceptance: build/typecheck; negative/adversarial and upstream-example tests; node-confirmed create/update/deactivate demo including key rotation and credential checks; documented exact commands and supported subset, node/source trust limits and draft spec discrepancies; reviewed public GitHub publication (authorized in the continuation). No full conformance/security claim, UI, messages, recurring automation or license added.
