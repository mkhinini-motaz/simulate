# Contributing

Ways to help, easiest first. Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

## 1. Report a run on your project

The README says reports from other projects are welcome. Open the "Field report" issue form. Wins, misses and runs that found nothing all count. Remove private details first: no company names, no real users, no secrets, no real hostnames in logs or screenshots.

## 2. Fix a bug

Open the "Bug" issue form, or pick an issue labelled `good first issue`. Any change to `skills/simulate/core/` needs a test in `skills/simulate/core/test/`.

## 3. Add to a case list

The case lists are in `skills/simulate/references/`: `coverage.md` (section 2 lenses, section 3 marketplace cases) and `profiles.md` (starter rules and scenarios per profile). Add a case that came from a real bug class, in the same short style. Use invented names and no figures from any real product.

## 4. Support another stack

The bots talk to your app over HTTP, so the app can be in any language. The gaps are in detect and in the demo:

- `coverage.md` names route-list commands for Laravel, Rails, Django, Next.js and the Express family only.
- `demo/app/` is a Node app. A small demo in another stack, with its own planted bugs, would show the skill works there.

Open the "Idea" issue form first, so two people do not start the same stack.

## Writing or changing the skill

Format: https://agentskills.io/specification. `.github/check-skills.py` checks it in CI.

- `name` is 1-64 characters (a-z, 0-9, single hyphens) and equals the folder name.
- `description` says what the skill does and when to use it. Put the use case first: the listing cuts the description at 1,536 characters. The hard limit is 1,024.
- Keep `SKILL.md` under 500 lines. Put details in `references/`.

## Bump the version

When you change anything under `skills/`, raise `version` in `.claude-plugin/plugin.json`. Installed copies update only when the version rises.

## Pull request process

- Open the "Idea" issue form first for new work, so two people do not start the same thing.
- One change per PR.
- Use a Conventional Commits title, for example `fix: ...` or `docs: ...`.
- By contributing you agree your work is MIT licensed.

## AI-assisted changes

AI help is fine. You must be able to explain the change yourself. Say in the PR which parts an AI wrote. Run the checks yourself, do not rely on the AI's word that they pass.

## Before you open a PR

From the repo root:

```
npm test
claude plugin validate .
python3 .github/check-skills.py skills/simulate
```

`npm test` needs Node 24 or later and no dependencies. CI runs it on Node 24 and 25 (`.github/workflows/test.yml`).

- [ ] `npm test` passes.
- [ ] `claude plugin validate .` passes.
- [ ] `python3 .github/check-skills.py skills/simulate` passes.
- [ ] I raised `version` if I changed anything under `skills/`.
- [ ] A change to `skills/simulate/core/` comes with a test.
- [ ] No secrets, tokens, real names or private data in fixtures, logs or screenshots.
- [ ] No names, prices or rules from a real product in the references.
