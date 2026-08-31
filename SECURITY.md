# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x (latest) | ✅ |
| < 0.1.0 | ❌ |

dsh-lowtide is currently in release-candidate status. Only the latest
release receives security fixes.

## Reporting a Vulnerability

Please **do not open a public issue** for security vulnerabilities.

Instead, report privately via **GitHub Security Advisories** on this
repository (*Security* tab → *Report a vulnerability*). You should receive an
acknowledgement within 72 hours. If the report is confirmed, we will:

1. Confirm the scope and impact with you.
2. Develop and test a fix.
3. Publish a patch release and credit you in the advisory (unless you prefer
   to remain anonymous).

## Security Model (what to know before running)

- **Unattended execution**: off-peak batches run with `approval=never`
  permission presets (`lt-readonly` / `lt-standard` / `lt-trusted`). Treat
  queued task prompts as code that will execute — adjudication is the only
  gate, and it is yours.
- **Trust fence**: all HTTP routes under `/ds-lowtide/` are guarded by a
  same-origin + loopback trust fence (`sec-fetch-site` cross-site requests
  are rejected). **Do not expose port 3080 to the public internet**; use an
  SSH tunnel or an authenticated reverse proxy.
- **Sandbox strength**: Windows sandboxing is mitigation-grade (partial);
  Linux/macOS enforce fully. For unattended use, stack the task-level
  locked-files allowlist (sha256-verified) and the daily budget backstop.
- **State file**: `lowtide.json` contains full task prompts and paths.
  Protect your backups accordingly.
- **Credentials**: the plugin neither ships nor stores model credentials; it
  uses the models configured in your dsh installation.

## Threat Model (loopback trust boundary)

The plugin's HTTP API (`/ds-lowtide/*`) is **unauthenticated by design**: the
trust boundary is the loopback interface plus the Host/Origin same-origin
fence. Concretely:

- **Any local process can drive the queue.** Whoever can open a TCP
  connection to 127.0.0.1 on the dsh port can submit tasks, approve them, and
  trigger `batch/run-now`. There is no token, no session, no ACL.
- **A queued task prompt is code waiting to execute.** Off-peak batches run
  unattended with `approval=never` presets, so a prompt submitted via the API
  becomes agentic activity on your workspace without further confirmation.
- **`approve-all` and `run-now` are intentional escape hatches.** They exist
  so the operator can force-run the queue manually; they are not gated and
  this will not change — gating them would break the local-operator workflow
  the plugin is built around.

**Recommendation**: run dsh-lowtide only on a trusted single-user machine.
Do not expose the port beyond loopback (no LAN binding, no unauthenticated
reverse proxy); for remote access use an SSH tunnel. Treat every local
process as capable of scheduling unattended LLM work on your behalf.
