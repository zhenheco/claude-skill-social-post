# Social Post Skill Checkout

This repository is a standalone checkout of the `social-post` Claude skill.
On this machine, the live CC CLI skill source is `$CC_CLI_HOME/skills/social-post`
with `$CC_CLI_HOME` defaulting to `$HOME/Documents/CC Cli`.

## Boundaries

- Do not assume edits here update the live CC CLI skill install.
- Before changing live automation behavior, verify the realpath of
  `$CC_CLI_HOME/skills/social-post`.
- Keep secrets out of this repo. Use `op://` references, local placeholders, or
  platform secret stores only.

## Local Gates

- Root check: `npm run check`
- Root test: `npm test`
- Skill tests directly: `npm --prefix social-post test`
