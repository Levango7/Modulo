# Code Signing Policy

**Project:** Modulo — a local-first card/layout workbench (Windows desktop + web).
**Repository:** <https://github.com/Levango7/Modulo> (Apache-2.0)
**Last updated:** 2026-10-09

> 本页按代码签名服务方（SignPath Foundation）的要求用英文撰写，供其审核与安全研究人员阅读；
> 仓库其余文档以中文为主。

Modulo's Windows release artifacts are code-signed through
[SignPath Foundation](https://signpath.org/)'s free signing program for open-source projects.
This page documents what is signed, who can approve signing, and how to verify a release.

## What is signed

- The Windows installer published on GitHub Releases:
  `Modulo_<version>_x64-setup.exe` (an NSIS installer containing the application binary `modulo.exe`).
- Nothing else is Authenticode-signed. The npm package `@levango7/engine` relies on the npm
  registry's own integrity mechanisms; the web build is served over HTTPS from GitHub Pages.

## Who signs

Signing is performed by SignPath Foundation on behalf of the project. The signing key is held in
SignPath's HSM; it never enters this repository or its CI runners. The resulting certificate
subject is **SignPath Foundation** (as is the case for all projects using this program).

## Roles and approval

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
2. The unsigned installer is submitted to SignPath; the **Approver approves the signing request**
   after checking provenance (which commit built it) and content.
3. SignPath returns the signed installer. The updater signature (`.sig`) is then computed **over
   the signed bytes** — Authenticode signing always precedes the updater signature, because the
   latter must match the exact bytes users download.
4. Installer + `.sig` + `latest.json` are published to GitHub Releases; the update manifest is
   verified against the public key embedded in the application (`src-tauri/tauri.conf.json`,
   updater `pubkey`) before the release is published.

## Verification

- **Updater signature:** every release ships `Modulo_<version>_x64-setup.exe.sig`, verifiable
  against the public key embedded in the application (minisign-compatible Tauri updater format).
- **Authenticode (starting with the first SignPath-signed release):** on Windows,
  `Get-AuthenticodeSignature .\Modulo_<version>_x64-setup.exe` reports a valid signature with
  subject `SignPath Foundation`.
- SHA-256 digests of release assets are recorded in the repository's release ledger
  (`release-manifest.json`) and machine-checked by CI.

## Current status

As of `v0.8.1` (2026-10-09), releases are **not yet Authenticode-signed**:
`TAURI_SIGNING_PRIVATE_KEY` covers only the in-app updater signature, so Windows SmartScreen
still shows "Unknown publisher". SignPath Foundation integration is in progress; once active,
every future release will be signed as described above.

## Changes and revocation

This policy may be updated as practices evolve; material changes remain visible in the
repository's history. SignPath Foundation may suspend or revoke the signing certificate per its
[terms](https://signpath.org/terms). If a signing credential were ever compromised, the project
would request revocation and publish a security advisory.
