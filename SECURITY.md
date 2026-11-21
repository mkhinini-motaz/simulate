# Security

## Report a vulnerability

- Open the **Security** tab of this repository and choose **Report a vulnerability**. The report stays private.
- If that button is missing, open an issue titled "Security contact" with no details. The maintainer will reply and arrange a private channel.

Do not post details, tokens or proof-of-concept output in a public issue.

## In scope

- The guard in `skills/simulate/core/`: a run that reaches a production database host, a live secret or a real `HOME` when the guard should have refused.
- The egress trap: outbound HTTP, SMS, mail or payments that leave the machine during a run.
- A fixture, log or run folder that holds a secret or private data.

## Out of scope

- Findings that need you to run code you wrote yourself.
- Weaknesses in Claude Code, Node, Python or GitHub themselves. Report those to their owners.
