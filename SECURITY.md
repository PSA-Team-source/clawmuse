# Security policy

ClawMuse runs AI agents that can read files, run shell commands and drive a browser on the user's
own computer, so security reports are taken seriously and handled privately.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a security problem.**

Report it through GitHub's private vulnerability reporting:

1. Open the repository's [Security tab](https://github.com/PSA-Team-source/clawmuse/security).
2. Choose **Report a vulnerability** ([direct link](https://github.com/PSA-Team-source/clawmuse/security/advisories/new)).
3. Describe the problem, the affected version (*Settings → About*), your OS, and the steps to
   reproduce it. A proof of concept helps.

Only the maintainers can see the report. We will:

- acknowledge it within **3 working days**;
- confirm or rule out the issue and share our assessment within **10 working days**;
- agree a disclosure date with you, normally once a fixed release is available and at most 90 days
  after the report;
- credit you in the published advisory unless you prefer not to be named.

## Scope

In scope:

- the ClawMuse desktop app in this repository: the Electron main, preload and renderer processes,
  IPC, the secure store, deep links (`clawmuse://`), the installers and the update path;
- how ClawMuse installs, configures and connects to the local OpenClaw gateway, including the
  gateway token and device identity it generates.

Examples: escaping context isolation, a web page or chat message making the app run commands
without an approval, reading another app's secrets, a key ending up in logs or in the app bundle.

Out of scope, and better reported elsewhere:

- vulnerabilities in [OpenClaw](https://github.com/openclaw/openclaw) itself; report those to that
  project;
- vulnerabilities in Electron or Chromium that ClawMuse does not make worse;
- actions an agent takes with permissions the user granted it (a bot with shell access can run
  shell commands; that is the documented design, see the README's *Limits*);
- unsigned-build warnings from Gatekeeper or SmartScreen.

## Supported versions

Security fixes go into the latest release. Please reproduce on it before reporting.
