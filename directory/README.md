# simulate (directory version)

Simulation testing for Claude Code. Bots play your users against an isolated copy of your app, checks enforce the rules you confirm, and every finding becomes a failing test in your own suite.

This is the directory version of the plugin. It holds only Markdown and JSON, with no code files. The real core of the simulator, which holds the safety guard, is therefore written as a spec in the skill's references folder, together with the test cases it must pass.

On its first run in a project, Claude builds the core into the project's `sim/core/` folder from that spec. It then writes the test cases as tests, runs them, and refuses to start any simulation until every case passes. If a case keeps failing, it stops and tells you which one.

The full version, with the core as ready-made code and a demo app, installs with this command inside a session:

    /plugin install simulate --marketplace mkhinini-motaz/simulate

Source and issues: https://github.com/mkhinini-motaz/simulate. MIT license.
