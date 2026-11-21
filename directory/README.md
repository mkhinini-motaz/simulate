# simulate (directory version)

Simulation testing for Claude Code. Bots play your users against an isolated copy of your app, checks enforce the rules you confirm, and every finding becomes a failing test in your own suite.

This is the directory version of the plugin. It holds only Markdown and JSON, with no code files. The real core of the simulator, which holds the safety guard, is therefore written as a spec in the skill's references folder, together with the test cases it must pass.

On its first run in a project, Claude builds the core into the project's `sim/core/` folder from that spec. It then writes the test cases as tests, runs them, and refuses to start any simulation until every case passes. If a case keeps failing, it stops and tells you which one.

## Where it works

Claude Code only, on a machine that can start your app locally. It needs Node 24 or later, git, and your app's own start commands. Chat and Cowork load the skill but cannot run it.

## What it runs and sends

- It writes a `sim/` folder in your project: the rules, the plan, the core, the scenarios and each run's logs.
- It starts a copy of your app from a clean checkout, with its own database ending in `_sim`, its own ports and its own cache. Bots call that copy over HTTP on your machine.
- A local proxy refuses every outbound request and fails the run on any attempt. Your app's senders (SMS, email, payments, webhooks) write to a local file instead.
- When it confirms a bug, it writes a failing test in your project's own test suite. It does not change product code unless you ask.
- The plugin has no server and no telemetry. Nothing leaves your machine.

## Examples

- `/simulate plan`: learn the product, ask what must never happen, and write the rules and the plan.
- `/simulate every-scenario`: run every scenario once, then triage and report.
- `/simulate scenario <name>`: run one scenario, for one bug or one new feature.

To try it on a small app first, clone the repository: its `demo/` folder is a marketplace API with six planted bugs.

## Troubleshooting

- **The guard refuses to start.** It lists its reasons, such as a database name without `_sim` or a production host in the settings. Fix those settings; never bypass the guard.
- **A core test case keeps failing.** Install the full version, which ships the tested core, or open an issue with the case title.
- **The app cannot start locally.** The skill needs start commands it can run and a database it can own. The skill's "When the skill can build" section lists what it needs.

The full version, with the core as ready-made code and a demo app, installs with this command inside a session:

    /plugin install simulate --marketplace mkhinini-motaz/simulate

Source and issues: https://github.com/mkhinini-motaz/simulate. MIT license.

## Support

Questions and bugs: open an issue at https://github.com/mkhinini-motaz/simulate/issues. Security problems: report them privately from the repository's Security tab (private vulnerability reporting), not in a public issue.
