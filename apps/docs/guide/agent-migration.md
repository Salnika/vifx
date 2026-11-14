# Migrate with an AI Agent

A coding agent (Claude Code, Codex, Cursor, GitHub Copilot or another one that can run commands) can carry out the whole [migration](/guide/migration) of an Expo app for you. The prompt on this page has it install Vifx, generate its config, port `metro.config.js`, bundle the app with Metro and with Vifx to compare the two, run it in Expo Go, and report what it did.

The prompt keeps the migration additive: Metro, `expo start`, EAS and your scripts keep working, nothing is committed, and the report ends with the steps to undo it.

## Use it

1. Commit or stash your work, so the migration's diff stays readable.
2. Open your agent at the root of the Expo app.
3. Give it the prompt below. Paste it, or point the agent at its raw URL:

   ```text
   Follow https://salnika.github.io/vifx/prompts/migrate-expo-to-vifx.md to migrate this app.
   ```

4. Review the report and the diff. Then run the app yourself if the agent could not start a simulator or a device.

The agent asks you before building the native apps in Release (step 7), and stops on anything the prompt does not cover, such as a custom Metro `serializer`, which has no Vifx equivalent.

The prompt was tried with an agent on a fresh Expo SDK 58 template: setup, both bundlers on iOS and Android, and the app in Expo Go on an iOS simulator and an Android emulator with Fast Refresh.

## The prompt

<<< @/public/prompts/migrate-expo-to-vifx.md{md}

## What to check afterwards

- **The comparison with Metro.** A Vifx bundle about 5 to 10 % smaller than Metro's (it drops modules Metro keeps), and the same asset files apart from Vifx's `assetmap.json`. A missing image or font in the Vifx assets is a bug: please [report it](https://github.com/Salnika/vifx/issues) with the file names.
- **The app in Expo Go.** Images, icons and fonts, navigation, and a `fast refresh` line in the terminal after an edit. [Dev Server and Fast Refresh](/guide/dev-server) describes the terminal output.
- **What is not covered.** [Project Status](/guide/status) lists the known gaps against Expo CLI, and the [support matrix](/reference/support-matrix) lists the libraries checked so far.
