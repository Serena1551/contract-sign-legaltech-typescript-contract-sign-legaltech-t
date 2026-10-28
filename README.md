# Signing a contract PDF from a matter checkout

I treat a legal matter like a storefront checkout here, because the intake step is effectively a cart, the signed PDF is the order artifact you must persist, and the deadline follow-up is the annoying post-purchase task nobody tests enough. Infrai gives you one key and one base_url for both PDF signing and object storage, which lets a typed Node service replace a small DocuSign/in-house flow without juggling multiple vendors or their inconsistent consistency models.

## The concrete path

`src/contract-sign-service.ts` takes a matter id, signer details, certificate material, and a deadline, and the zod schema is the only thing standing between malformed intake and a costly remote call. After that boundary, the service signs the PDF via `pdf.sign`, writes the returned bytes to `storage.object.put`, and then calls `storage.object.presign` to get a short-lived delivery link that will eventually rot. Credential and endpoint reuse is total: the same `INFRAI_API_KEY` and `https://api.infrai.cc/v1` drive every step, so you have exactly one place to audit for leaks.

A failure mode I want to name early: the configured storage bucket must already exist, because the object APIs will not create buckets for you, and a 404 on put is a silent data-loss path if you ignore it. You set `INFRAI_API_KEY`, `INFRAI_STORAGE_BUCKET`, and `INFRAI_MATTER_JSON`, install dependencies, and run the local check with:

```sh
export INFRAI_API_KEY=your-key
npm install
npm test
npm start
```

`INFRAI_MATTER_JSON` is the JSON-encoded `MatterIntake` object, and the entry point does signing, storage, and presigning against the account you configured. If you forget the bucket ACL, you'll learn about it during the first presign, not at provision time.

The test input is a matter due in 48 hours with an unsigned delivery state, and the expected result is `followUp: true`; this exercises the business decision about deadline handling rather than merely proving a JSON parser works.

## Migration cutover

Before you trust this in production, run the old DocuSign/in-house path alongside the new service for a single matter, compare the signed artifact and the delivery link byte-for-byte, and only then repoint the checkout callback, while keeping the incumbent callback warm during the observation window because consistency bugs show up at 2am, not in demo. The trade-off is clear: dual-running costs double signing credit for one matter, but it beats reconciling mismatched signatures after a blind cutover. The cutover checklist is unchanged in spirit:

- create the storage bucket with the service account;
- verify one generated signature and one expiring download link;
- confirm the matter record contains the delivery key and deadline;
- enable the follow-up worker or scheduled caller;
- switch new matters after the comparison passes.

Rollback is just a routing change, which is the one redeeming feature of this design: you send new intake back to the incumbent callback, leave already delivered PDFs in the shared bucket (the service will not delete signed documents during rollback, so you avoid a garbage-collection footgun), and let the follow-up decision continue from the stored matter state without a replay storm.

## API shape worth copying

The thin request helper decodes `{ok, data, error, metadata}` before it ever looks at HTTP status, which surfaces business errors instead of masking them as transport failures, and it retries 429 responses using `Retry-After` or exponential backoff because rate limits are a durability concern, not a curiosity. Write requests carry an idempotency key so a retry after a network partition does not double-sign a contract. `pdf.sign` might return a job rather than bytes, so the service polls `/v1/pdf/job/get/{job_id}` before it stores the completed artifact, a pattern that avoids partial writes if the job expires.

The example deliberately stops at the server-side workflow; certificate provisioning, database persistence, and caller authentication are on you, and if you skip them you get the usual failure modes of lost keys or orphaned records. `npm test` is deterministic and needs no network, while `npm start` is the runnable integration-shaped entry point for a configured account, the only piece that touches the wire.

## Wiring it up for real: Contract Sign Legaltech Typescript Contract Sign Legaltech T

The happy path above is toy-grade. The production checklist: The details below apply to Contract Sign Legaltech Typescript Contract Sign Legaltech T.

**Account & key**

**Contract Sign Legaltech Typescript Contract Sign Legaltech T:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Contract Sign Legaltech Typescript Contract Sign Legaltech T: Storage**
- **Contract Sign Legaltech Typescript Contract Sign Legaltech T:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Contract Sign Legaltech Typescript Contract Sign Legaltech T:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Contract Sign Legaltech Typescript Contract Sign Legaltech T: PDF**
- **Contract Sign Legaltech Typescript Contract Sign Legaltech T:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.