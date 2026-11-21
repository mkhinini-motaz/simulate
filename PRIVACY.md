# Privacy

Last updated 21 November 2026. This covers the simulate plugin.

- The author runs no server and collects nothing. The plugin has no telemetry, no analytics and no account.
- What Claude reads while you use the plugin goes to Anthropic as part of your conversation, under your Claude plan's terms and [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
- Runs happen on your machine, against a copy of your app with its own `_sim` database. A local proxy refuses every outbound request from that copy.
- The `sim/` folder, run logs and the failing tests it writes stay in your project.

Questions: open an issue at https://github.com/mkhinini-motaz/simulate/issues.
