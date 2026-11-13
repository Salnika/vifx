# Security policy

## Supported versions

Vifx is pre-1.0. Security fixes are released for the latest published version only.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability**. Include what is affected, how to reproduce it and the impact you expect.

You will get an acknowledgement within a week. Once the issue is confirmed, a fix is prepared in a private advisory and published with a release; you are credited unless you prefer not to be.

Vifx runs build tooling on your machine: it executes your project's configuration files (`vifx.config.ts`, `vite.config.vifx.ts`, `babel.config.js`) and the dev server serves your project's files on your network. Running Vifx on a project means trusting that project's code, as with any bundler.
