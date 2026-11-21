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

## Before you open a PR

From the repo root:

```
npm test
claude plugin validate .
```

`npm test` needs Node 24 or later and no dependencies. CI runs it on Node 24 and 25 (`.github/workflows/test.yml`).

- [ ] `npm test` passes.
- [ ] `claude plugin validate .` passes.
- [ ] A change to `skills/simulate/core/` comes with a test.
- [ ] No secrets, tokens, real names or private data in fixtures, logs or screenshots.
- [ ] No names, prices or rules from a real product in the references.
