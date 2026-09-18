---
name: init
description: Install or refresh the web-dev harness state in the current project — config, shards, blueprint, product, stack, decisions, agents, path rules, the wd shim and the pinned parser. The gates already run from the plugin; this gives them a project to enforce against. Run once per project, and again after updating the plugin.
disable-model-invocation: true
argument-hint: "[project root — defaults to the current directory]"
---

# web-dev init

Install the web-dev harness into the project at `$ARGUMENTS`, or into the current working directory when no argument was given.

1. Resolve the target directory and confirm `node --version` is 20 or newer.
2. If the target is not a git repository, ask the user whether to run `git init -b main` there. Do not create the repository without their answer.
3. Run the installer and show its output to the user:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/init_project.mjs" "<target>" --setup
   ```
   Re-running it is safe:
   - project state files are kept as they are;
   - the web-dev agents, path rules and the `wd` shim are refreshed to this plugin version;
   - a legacy `.claude/hooks/web-dev/` copy from v1 is removed, because v2 runs the hooks from the plugin;
   - an existing `.claude/settings.json` is merged and a backup is kept.
4. Relay every `warning` line from the output, and say what each one means for the user.
5. Offer to commit the harness on the default branch with `git add .claude CLAUDE.md .gitignore && git commit -m "chore: add web-dev harness"`. Commit only if the user agrees.
6. Tell the user what is already true and what waits for the next session:
   - the gates are armed from the next tool call, because `.claude/web-dev/` now exists — no restart is needed;
   - confirm with `node .claude/web-dev/wd.mjs task status`;
   - the full `[web-dev]` line appears at the start of the next session;
   - if `/hooks` shows nothing from web-dev, the plugin itself is disabled — that is the one thing a restart will not fix.
7. Name the next step:
   - for a new project, describe the app, which starts bootstrap;
   - for an existing codebase, ask to adopt it.
