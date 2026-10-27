# Code Signing Policy

**Project:** Modulo — a local-first card/layout workbench (Windows desktop + web).
**Repository:** <https://github.com/Levango7/Modulo> (Apache-2.0)
**Last updated:** 2026-10-18

> 本页按代码签名服务方（SignPath Foundation）的要求用英文撰写，供其审核与安全研究人员阅读；
> 仓库其余文档以中文为主。

Modulo's Windows release artifacts are **not yet Authenticode-signed**. The project intends to
use [SignPath Foundation](https://signpath.org/)'s free signing program for open-source projects,
and this page documents both that intended arrangement and the current status; the application
is **pending** (deferred, "one step slower", as of 2026-10-18) and has not been submitted.
Until the program is active, releases ship unsigned: Windows SmartScreen will show
"Unknown publisher", and update packages are protected by the Tauri updater's minisign
signature instead (see Verification). **The "Current status" section at the bottom is
authoritative for what is actually signed today** — earlier sections describe the process
that will apply once signing is active, and are marked where that is the case.

## What is signed

- **Nothing is Authenticode-signed today** (baseline: v0.8.7, 2026-10-27; see Current status).
- Once the SignPath program is active, the artifact to be signed will be the Windows installer
  published on GitHub Releases: `Modulo_<version>_x64-setup.exe` (an NSIS installer containing
  the application binary `modulo.exe`).
- Nothing else will be Authenticode-signed. The npm package `@levango7/engine` relies on the npm
  registry's own integrity mechanisms (plus npm provenance attestations); the web build is
  served over HTTPS from GitHub Pages.

## Who signs

*Applies once the SignPath application is approved.*

Signing will be performed by SignPath Foundation on behalf of the project. The signing key will
be held in SignPath's HSM; it never enters this repository or its CI runners. The resulting
certificate subject will be **SignPath Foundation** (as is the case for all projects using this
program).

## Roles and approval

*Applies once the SignPath application is approved. Until then, no signing requests exist and
these steps are not exercised.*

The project maintains three explicit roles, as required by the SignPath open-source model:

| Role | Who | Duty |
| --- | --- | --- |
| Author | Levango7 (project maintainer) | Prepares a release: version bump, changelog, signed git tag on CI-green `master`, and the CI build that produces the artifact. |
| Reviewer | Levango7 | Confirms the artifact was built from the intended commit and that all required CI checks (tests, type checks, desktop probe) passed for that commit. |
| Approver | Levango7 | Approves **each individual signing request** before the artifact is signed. No request is auto-approved. |

This is a single-maintainer project, so one person holds all three roles; the roles are still
exercised as separate, explicit steps for every release. Multi-factor authentication is required
on the GitHub account and on the SignPath account used for review and approval.

## Release process

1. A release starts from a **signed git tag** whose commit passed all required CI checks;
   the installer is built by CI from that exact commit (GitHub release assets show
   `github-actions[bot]` as the uploader).
2. *Applies only after the SignPath application is approved — not applicable today.* The unsigned
   installer is submitted to SignPath; the **Approver approves the signing request** after
   checking provenance (which commit built it) and content.
3. *Applies only after the SignPath application is approved — not applicable today.* SignPath
   returns the signed installer. The updater signature (`.sig`) is then computed **over
   the signed bytes** — Authenticode signing always precedes the updater signature, because the
   latter must match the exact bytes users download. (Today there is no Authenticode step, and
   CI computes the `.sig` over the unsigned installer bytes; the two are consistent because no
   bytes change in between.)
4. Installer + `.sig` + `latest.json` are published to GitHub Releases; the update manifest is
   verified against the public key embedded in the application (`src-tauri/tauri.conf.json`,
   updater `pubkey`) before the release is published.

## Verification

- **Updater signature:** every release ships `Modulo_<version>_x64-setup.exe.sig`, verifiable
  against the public key embedded in the application (minisign-compatible Tauri updater format).
  This is the integrity mechanism in force today.
- **Authenticode:** *not yet applicable* (no release is signed). When signing is active, on
  Windows `Get-AuthenticodeSignature .\Modulo_<version>_x64-setup.exe` should report a valid
  signature with subject `SignPath Foundation`. As of the 2026-10-18 baseline (v0.8.3) the
  command reports **NotSigned**; the control check on the same machine (`cmd.exe`) reports
  **Valid**, so the negative result is about the artifact, not the command. Method note: always
  reconcile the downloaded artifact first (size + sha256 against `release-manifest.json` and the
  GitHub release asset digest) before running signature checks — a truncated download otherwise
  produces a meaningless negative.
- SHA-256 digests of release assets are recorded in the repository's release ledger
  (`release-manifest.json`) and machine-checked by CI.

## Current status

As of **2026-10-27** (baseline release: **v0.8.7**), releases are **not yet Authenticode-signed**.
Evidence (2026-10-27 / 2026-10-25 / 2026-10-22 / 2026-10-18, maintainer machine):

- The v0.8.7 installer was downloaded from its GitHub Release (draft stage) in full: **10,107,913 bytes**,
  sha256 **`274caa4be789491b3ed0e65fd8fde863630a396255dc1d72126b840e3bb9a00a`** — matching the GitHub
  release asset digest and `release-manifest.json` (three independent sources).
  `Get-AuthenticodeSignature` on it reports **NotSigned**; control: the same command on
  `C:\Windows\System32\cmd.exe` reports **Valid** on the same machine. Checked 2026-10-27 during the
  pre-release drill (hard step 5 of the release process).
- The v0.8.6 baseline (2026-10-25) was measured the same way: **NotSigned**, 10,046,654 bytes,
  sha256 **`104f1f1a01edd65224e6db8f8cb9754398ed45f2b1288836542771aef04901a9`**. The v0.8.4 baseline
  (2026-10-22): **NotSigned**, 4,255,593 bytes, sha256 **`cd9cb8a7…14cfa`** — checked after the
  release. The v0.8.3 baseline (2026-10-18): **NotSigned**, 4,042,044 bytes,
  sha256 **`7eb1145c…d3646`**. An initial truncated download (2,732,222 bytes) failed the hash check
  and was discarded before any signature check — the reason the download is hashed first.
- `Get-AuthenticodeSignature` on the downloaded installer reports **NotSigned**. Control: the
  same command on `C:\Windows\System32\cmd.exe` reports **Valid** on the same machine.
- CI contains no signing step for the installer: `.github/workflows/ci.yml` only carries
  `TAURI_SIGNING_PRIVATE_KEY`, which produces the updater's minisign `.sig`.
- The SignPath Foundation application has **not been submitted** (deferred by project decision,
  2026-10-18). The project intends to keep this plan; this section will be updated when the
  status changes, and the architecture doc's release process cross-checks the actual signature
  status of published assets against this page (a mismatch blocks the release until the page is
  corrected — "signed but nobody knows" and "declared but not signed" are both worse than an
  honest baseline).

## Changes and revocation

This policy may be updated as practices evolve; material changes remain visible in the
repository's history. SignPath Foundation may suspend or revoke the signing certificate per its
[terms](https://signpath.org/terms). If a signing credential were ever compromised, the project
would request revocation and publish a security advisory.
