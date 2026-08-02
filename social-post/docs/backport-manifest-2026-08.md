# Social-post backport manifest — 2026-08

Scope: public fork social-post/ only. Canonical source is
$CC_CLI_HOME/agents-skills/social-post ($CC_CLI_HOME defaults to the local
CC CLI vault). This manifest contains no personal absolute paths, channel IDs,
email addresses, Telegram IDs, or fixture literals.

## Diff evidence

Command run:

    diff -rq "$CC_CLI_HOME/agents-skills/social-post" "$REPO_ROOT/social-post"

Canonical source commit after the required first step:
1b9e28c86c2f74a6428bd29ae3286396a6ef5707

Repo baseline: e233d07 (fix: remove social-post secret-shaped fixtures).
The diff reported 31 relative-path differences:

- Canonical-only: F19_DEPLOYMENT_KIT.md, UPSTREAM.md, content_plan.md,
  lib/material/flywheel-articles.mjs, lib/posting/channels.json,
  lib/posting/image-gen.mjs, scripts/post.mjs,
  tests/content-plan-contract.test.mjs, tests/flywheel-articles.test.mjs,
  tests/image-gen.test.mjs, tests/post-cli.test.mjs.
- Repo-only: tests/audit-gates.test.mjs.
- Modified in both trees: SKILL.md, content_plan.example.md,
  dashboard/static/dashboard.js, lib/posting/postiz-adapter.mjs,
  lib/registry.mjs, lib/voice-bootstrap/discovery.mjs,
  references/{case_studies,evaluation,facebook,formulas,phase0_plan,rules}.md,
  scripts/{autopilot,generate-brief}.mjs,
  tests/{autopilot,generate-brief-cli,postiz,registry,secret}.test.mjs.

## Per-file decisions

### sync

| Repo-relative path | Reason |
|---|---|
| social-post/F19_DEPLOYMENT_KIT.md | Canonical public deployment documentation; required by the canonical SKILL reference. |
| social-post/SKILL.md | Sync repaired routing, safety, and current public skill contract. |
| social-post/content_plan.example.md | Sync the generic, non-personal public example; the live plan itself remains excluded. |
| social-post/dashboard/static/dashboard.js | Sync the canonical dashboard data/view contract while retaining the repo's existing DOM-safe renderer; the canonical string-HTML renderer fails the repo-only public audit gate, so this security-preserving implementation is the required backport form. |
| social-post/lib/material/flywheel-articles.mjs | Restore the flywheel-material bridge required by the current brief pipeline. |
| social-post/lib/posting/image-gen.mjs | Sync with post.mjs as one dependency-closed posting batch. |
| social-post/lib/posting/postiz-adapter.mjs | Sync the Postiz adapter with the vault registry and posting CLI. |
| social-post/lib/registry.mjs | D9 explicitly requires the vault registry and same-batch adapter. |
| social-post/lib/voice-bootstrap/discovery.mjs | Special sync: take canonical syntax/structure, then preserve the repo's current redacted fixture expressions. |
| social-post/references/case_studies.md | Sync canonical public reference content. |
| social-post/references/evaluation.md | Sync canonical public evaluation guidance. |
| social-post/references/facebook.md | Sync canonical public platform guidance. |
| social-post/references/formulas.md | Sync canonical public formula reference. |
| social-post/references/phase0_plan.md | Sync canonical public planning reference. |
| social-post/references/rules.md | Sync canonical public rules reference. |
| social-post/scripts/autopilot.mjs | Sync canonical autopilot implementation. |
| social-post/scripts/generate-brief.mjs | Sync canonical brief generation implementation. |
| social-post/scripts/post.mjs | Sync the post-PII, env/config-driven CLI from the required canonical commit. |
| social-post/tests/content-plan-contract.test.mjs | Add the canonical contract test accompanying the public content-plan contract. |
| social-post/tests/flywheel-articles.test.mjs | Add coverage for the restored flywheel bridge. |
| social-post/tests/image-gen.test.mjs | Add coverage for the synced image-generation module. |
| social-post/tests/post-cli.test.mjs | Add the required missing-fallback/live-channel runtime tests. |
| social-post/tests/autopilot.test.mjs | Sync tests for canonical autopilot behavior. |
| social-post/tests/generate-brief-cli.test.mjs | Sync tests for canonical brief generation behavior. |
| social-post/tests/postiz.test.mjs | Sync tests for the canonical Postiz adapter contract. |
| social-post/tests/registry.test.mjs | Sync tests with the canonical registry contract. |

### keep-repo

| Repo-relative path | Reason |
|---|---|
| .github/workflows/ci.yml | Repo-only CI wiring; do not replace with vault content. |
| AGENTS.md | Repo checkout guardrails and public-repo instructions. |
| social-post/package.json | Repo package/test contract; no canonical replacement is needed. |
| social-post/tests/audit-gates.test.mjs | Repo-only public audit gate coverage. |
| social-post/tests/secret.test.mjs | Preserve e233d07's redacted fixture expressions; canonical raw fixture literals are not allowed back into the public tree. |

### exclude

| Repo-relative path | Reason |
|---|---|
| social-post/content_plan.md | Personal live plan; never backport. |
| social-post/lib/posting/channels.json | Contains real Postiz channel values; post.mjs now treats it as optional and uses live integrations/config. |
| social-post/voice/ | Personal voice material; never publish. |
| social-post/core.yaml | Personal runtime config; never publish. The public social-post/schemas/core.yaml is code/schema and remains untouched. |
| social-post/UPSTREAM.md | Vault-only synchronization bookkeeping and local development history; not part of the public skill payload. |

There is no token-bearing file in the diff set. brand.example.yaml,
style_profile.example.md, and schemas/core.yaml are public examples/schema
files and are not excluded by this manifest.

## Discovery three-way guard

Compared:

1. canonical discovery.mjs;
2. repo HEAD at e233d07;
3. repo e233d07^ (the pre-redaction blob).

The external vault history references 17f73d5a2 and 5cbdb0b9a; both point to
the same syntax-broken intermediate fixture blob. Public e233d07 records the
redaction fix. The backport operation must therefore copy canonical
discovery.mjs only as an intermediate step, then restore the repo's existing
runtime-joined access-mode fragments and joined public-handle fixture
expressions. No canonical fixture literal may remain in the staged public
file. The final file must pass node --check.

## Execution order

1. Copy every sync row into the corresponding social-post/ path.
2. Handle discovery.mjs with the three-way guard above.
3. Do not copy any exclude row.
4. Preserve every keep-repo row.
5. Run the dependency-closure and five privacy gates before committing.
