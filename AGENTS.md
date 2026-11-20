# AGENTS.md

A Claude Code skill (`skills/simulate/`) packaged as a plugin (`.claude-plugin/`), plus a demo app with planted bugs (`demo/`).

- Test: `npm test` (Node 24 or later, no dependencies). It runs the core tests and proves the demo run finds every planted bug and raises no false alarm once they are fixed.
- `skills/simulate/core/` is the fixed safety and oracle code that the skill copies into a project verbatim. Change it only with a test in `skills/simulate/core/test/`.
- `skills/simulate/SKILL.md` follows the Agent Skills format: `name` matches the folder.
- Check the plugin after a change: `claude plugin validate .`
