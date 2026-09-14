---
name: init
description: Install or upgrade the web-dev harness in the current project — hooks, agents, rules, config, maps and the pinned parser. Run once per project after installing the plugin, and again after updating the plugin.
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
   - project state files are kept;
   - the hooks and the web-dev agents are refreshed to this plugin version;
   - an existing `.claude/settings.json` is merged, and a backup is kept.
4. Relay every `warning` line from the output, and say what each one means for the user.
5. Offer to commit the harness on the default branch with `git add .claude CLAUDE.md .gitignore && git commit -m "chore: add web-dev harness"`. Commit only if the user agrees.
6. Tell the user the harness activates in a new session, and what to check there:
   - start a new Claude Code session in the project, because project hooks load at session start;
   - accept the trust dialog;
   - `/hooks` lists SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, SubagentStart, SubagentStop and Stop;
   - the `[web-dev]` report appears at session start.
7. Name the next step:
   - for a new project, describe the app, which starts bootstrap;
   - for an existing codebase, ask to adopt it.
