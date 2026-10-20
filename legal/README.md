# DOHOY legal center

The six documents are drafts for review. No operator identity has been assumed and no draft is recorded as accepted. Complete the actual operator name/type, public address, contact email and phone in the administrator's legal editor. The text also needs a review of the actual labor/fiscal model and any activity-specific contracts, licenses and insurance. This implementation does not itself provide those instruments or implement tax withholding.

`legal/documents.json` is the checked-in draft source; `legal-documents.js` makes the same draft readable before a release is published. Database drafts remain private to administrators. The editor saves drafts, publishes a complete operator snapshot, and retires the previous release. Published text and operator details are immutable; prepare a new version for changes.

An acceptance records the authenticated account, audience, release ID, content SHA-256 and server timestamp. Users cannot insert or update acceptance rows directly. Privacy acknowledgment is separate from acceptance of use conditions and does not authorize optional advertising. When signup requires email confirmation, authenticated acceptance must be completed after sign-in; user metadata is not treated as proof of acceptance or authorization.

New task assignments capture an immutable service-agreement snapshot from the accepted proposal. Historical tasks are not backfilled and users are never marked as having accepted a document on their behalf. These records do not claim to replace employment, professional-service or other contracts required by law.

Live Checkout requires a published release and matching client/worker acceptance before creating a payment session. Existing paid receipts, support, profile and document reading remain available. Test-mode payments keep their existing test behavior.

Run `npm ci` and `npm test` for the JavaScript regressions. Database checks were run in a transaction and rolled back: draft isolation, own-account consent, server timestamps, publication immutability, old-version rejection, participant-only agreement access, accepted offers and accepted counteroffers. Browser visual QA is still pending; DOM and route behavior were tested without a browser.

Reference texts consulted on 2026-10-19:

- [LFPDPPP](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), privacy notices and ARCO rights.
- [LFT](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFT.pdf), digital-platform work and contracts.
- [LFPC](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf), electronic transactions and consumer rights.

Operational descriptions must continue to match the app. In particular: no automatic refund is promised by cancelling a task; recurring visits are paid separately; a Stripe transfer is distinct from a bank deposit; a declared professional license is not a verified credential.
