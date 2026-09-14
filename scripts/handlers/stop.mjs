import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { renderMaps } from '../build_maps.mjs';
import { formatCheck } from '../check_blueprint.mjs';
import { newErrors } from '../lib/checks.mjs';
import { loadConfig } from '../lib/config.mjs';
import { currentBranch, showFile, upstreamStatus } from '../lib/git.mjs';
import { sha256 } from '../lib/hash.mjs';
import { WD } from '../lib/hookio.mjs';
import { exists, mtimeMs, readJson, readText, removeFile, truncate } from '../lib/io.mjs';
import { layout } from '../lib/paths.mjs';
import { isAnalyzable, projectTags } from '../lib/project.mjs';
import { branchFiles, buildDiff, LOCKFILE, TOOL_OUTPUT, treeHash, UI_FILE, uiHash, workingChanges } from '../lib/review.mjs';
import { matchAny } from '../lib/shards.mjs';
import { approval, enforced, readStop, readTask, readTurn, writeStop, writeTask } from '../lib/state.mjs';
import { isCodeFile, loadTs } from '../lib/ts.mjs';
import { deepScan, hasBinary } from '../security/external.mjs';
import { formatFindings, isClientPath, isTestPath, scanContent } from '../security/scan.mjs';

const HARNESS = /^(\.claude\/|CLAUDE\.md$|CLAUDE\.local\.md$)/;
const CONFIG_FILE = /(^|\/)[^/]*\.config\.(m|c)?[jt]s$|(^|\/)(middleware|instrumentation)\.(t|j)s$/;

function turnFiles(root, turn) {
  const changed = workingChanges(root).map((e) => e.path);
  const recent = changed.filter((p) => mtimeMs(path.join(root, p)) >= (turn.startedAt || 0) - 1000);
  return [...new Set([...(turn.writes || []), ...recent])].filter((p) => !HARNESS.test(p) && exists(path.join(root, p)));
}

function closingChecks(root, { config, brief, health }) {
  const L = layout(root);
  const blockers = [];
  const notices = [];
  let pr = null;

  const verify = readJson(L.verifyState, null);
  const tree = treeHash(root);
  if (!verify) blockers.push(`no recorded verification: run ${WD} verify`);
  else if (verify.tree !== tree) blockers.push(`the code changed after the last ${WD} verify: run it again`);
  else if (!verify.ok) blockers.push(`${WD} verify failed: ${verify.summary}`);

  const files = branchFiles(root, config).filter((f) => !HARNESS.test(f));
  const tests = files.filter(isTestPath);
  const behavior = files.filter((f) => isCodeFile(f) && !isTestPath(f) && !CONFIG_FILE.test(f) && !TOOL_OUTPUT.test(f));
  if (behavior.length && !tests.length && !brief.testsNone) {
    blockers.push(`${behavior.length} source file(s) changed but no test changed: add tests for the acceptance criteria, or record the user's approval of "Tests: none — <reason>" in the brief`);
  }

  const ui = files.filter((f) => UI_FILE.test(f) && !isTestPath(f));
  if (ui.length) {
    const responsive = readJson(L.responsiveState, null);
    if (!responsive) blockers.push(`UI files changed: run ${WD} responsive for the routes in the brief`);
    else if (responsive.uiHash !== uiHash(root, files)) blockers.push(`UI changed after the last ${WD} responsive run: run it again`);
    else if (!responsive.ok) blockers.push(`${WD} responsive has findings: ${responsive.summary}`);
  }

  if (!health) blockers.push(`maps are not rendered (parser missing): run ${WD} setup`);
  else {
    if (health.owed?.length) blockers.push(`${health.owed.length} note(s) owed: ${WD} note missing`);
    const { introduced, preexisting } = newErrors(root);
    if (introduced.length) blockers.push(`${WD} check reports ${introduced.length} error(s) introduced by this task:\n${formatCheck(introduced, 10).text}`);
    if (preexisting.length) notices.push({ text: `web-dev: ${preexisting.length} check error(s) existed before this task and are carried to you (not blocking): ${preexisting.slice(0, 3).map((f) => f.code).join(', ')}`, blocking: false });
  }

  const review = readJson(L.reviewState, null);
  const diff = buildDiff(root, config);
  if (!review) blockers.push(`no supervisor review: run ${WD} review-prep, then the web-dev-reviewer subagent`);
  else if (review.verdict !== 'PASS') blockers.push(`reviewer verdict ${review.verdict}: fix the findings, then ${WD} review-prep and the reviewer again${review.findings?.length ? `\n${review.findings.slice(0, 8).join('\n')}` : ''}`);
  else if (!review.preparedFor || review.preparedFor !== diff.hash) blockers.push(`the diff changed after the review: ${WD} review-prep and run the reviewer again`);

  const records = [readText(L.product) || '', readText(L.stack) || '', readText(L.decisions) || ''].join('\n');
  for (const id of brief.durable) if (!new RegExp(`^\\s*${id}\\s*\\|`, 'm').test(records)) blockers.push(`${id} is listed under Durable but not recorded in product.md, stack.md or decisions.md`);

  const pending = workingChanges(root);
  if (pending.length) blockers.push(`uncommitted changes: ${pending.slice(0, 6).map((e) => e.path).join(', ')}${pending.length > 6 ? ' …' : ''}`);

  if (config.git.remote !== 'none' && !pending.length) {
    const branch = currentBranch(root);
    const up = upstreamStatus(root);
    if (!up.upstream) blockers.push(`the branch is not pushed: git push -u ${config.git.remote} ${branch}`);
    else if (up.ahead > 0) blockers.push(`${up.ahead} commit(s) not pushed: git push`);
    else if (config.git.pullRequest) {
      if (!hasBinary('gh')) notices.push({ text: 'web-dev: gh is not installed, so the PR cannot be verified. Open the PR, then tell the assistant its URL.', blocking: true });
      else {
        const r = spawnSync('gh', ['pr', 'view', '--json', 'url,state', '--jq', '.url + " " + .state'], { cwd: root, encoding: 'utf8', timeout: 30000 });
        if (r.status === 0) {
          const [url, state] = r.stdout.trim().split(' ');
          if (state === 'OPEN' || state === 'MERGED') pr = url;
          else blockers.push(`the PR ${url} is ${state}`);
        } else if (/no (open )?pull requests? found/i.test(r.stderr || '')) {
          blockers.push(`no PR exists for ${branch}: gh pr create --base ${config.defaultBranch} --head ${branch} --title "<type>(<scope>): <summary>" --body-file <(${WD} pr-body)`);
        } else {
          notices.push({ text: `web-dev: the PR could not be checked (${String(r.stderr || 'gh failed').trim().slice(0, 140)}). Check gh auth status, then continue.`, blocking: true });
        }
      }
    }
  }

  const deep = deepScan(root, files.filter((f) => !HARNESS.test(f)), config);
  if (deep.available && deep.findings.length) {
    blockers.push(`deep scan (${deep.tool}) findings:\n${deep.findings.slice(0, 8).map((f) => `- ${f.rule} ${f.file}:${f.line} ${f.message}`).join('\n')}`);
  }
  return { blockers, notices, pr };
}

export default async function ({ input, root }) {
  if (!enforced(root)) return null;
  const L = layout(root);
  const config = loadConfig(root);
  const ts = loadTs();
  const turn = readTurn(root);
  const blockers = [];
  const notices = [];
  const task = readTask(root);
  const status = exists(L.task) ? approval(root) : { ok: false };
  const brief = status.brief || null;

  let health = null;
  if (ts) {
    try {
      health = renderMaps(root);
    } catch (error) {
      notices.push({ text: `web-dev: map render failed: ${error.message}`, blocking: false });
    }
  }

  const files = turnFiles(root, turn);
  const tags = files.length ? projectTags(root, config) : [];
  for (const rel of files) {
    const text = readText(path.join(root, rel));
    if (text == null) continue;
    const generated = matchAny(rel, config.generated) || matchAny(rel, brief?.generated || []);
    const { findings } = scanContent({ ts, root: null, rel, newText: text, oldText: showFile(root, 'HEAD', rel), config, brief, tags, generated, clientFile: isClientPath(rel, text, tags) });
    if (findings.length) blockers.push(`${rel}:\n${formatFindings(findings, 6)}`);
    const exempt = generated || LOCKFILE.test(rel) || TOOL_OUTPUT.test(rel) || (rel.endsWith('package.json') && brief?.dependencies.length);
    if (!exempt && !(turn.writes || []).includes(rel)) {
      if (!status.ok) blockers.push(`${rel} changed this turn without an approved brief (outside Edit/Write): revert it with git checkout -- ${rel} or bring it into an approved brief`);
      else if (!brief.manifest.includes(rel)) blockers.push(`${rel} changed this turn outside the manifest: revert it or add it to the brief and ask for approval again`);
    }
  }

  if (health && files.length) {
    const touched = new Set(files.filter((f) => isAnalyzable(f, config)));
    const owed = (health.owed || []).filter((entry) => touched.has(entry.split(' (')[0].split('#')[0]));
    if (owed.length) blockers.push(`notes owed for files changed this turn (${WD} note set):\n${owed.slice(0, 20).map((o) => `- ${o}`).join('\n')}`);
  }

  let closed = false;
  let pr = task.pr || null;
  if (exists(L.postflight)) {
    if (!status.ok) blockers.push(`postflight exists but the brief is not approved: ${status.reason}`);
    else if (!blockers.length) {
      const result = closingChecks(root, { config, brief, health });
      blockers.push(...result.blockers);
      notices.push(...result.notices);
      if (!result.blockers.length && !result.notices.some((n) => n.blocking)) {
        closed = true;
        pr = result.pr || pr;
      }
    }
  }

  const systemMessage = notices.map((n) => n.text).join('\n');
  if (closed) {
    removeFile(L.task);
    removeFile(L.postflight);
    removeFile(L.prBody);
    writeTask(root, { state: 'closed', closedAt: new Date().toISOString(), closedSession: input.session_id || null, pr, approvedHash: null, reminded: false, title: brief.title });
    writeStop(root, { reason: '', count: 0 });
    return {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: `web-dev: every closing check passed and "${brief.title}" is closed${pr ? ` (${pr})` : ''}. Give the user the final summary now: the PR link, one line per acceptance criterion, and the recommendation to run /clear before the next task. Start no new work.`,
      },
      systemMessage: `web-dev: task closed${pr ? ` · ${pr}` : ''} · run /clear before the next task${systemMessage ? `\n${systemMessage}` : ''}`,
    };
  }

  if (blockers.length) {
    const reason = blockers.join('\n\n');
    const key = sha256(reason).slice(0, 16);
    const prior = readStop(root);
    const count = prior.reason === key ? prior.count + 1 : 1;
    writeStop(root, { reason: key, count });
    if (count >= 3) {
      return { systemMessage: `web-dev: the same problem blocked the end of the turn ${count} times and needs your decision:\n${truncate(reason, 1800)}${systemMessage ? `\n${systemMessage}` : ''}` };
    }
    return { decision: 'block', reason: `web-dev turn audit — resolve before ending the turn:\n${truncate(reason, 7000)}`, ...(systemMessage ? { systemMessage } : {}) };
  }
  writeStop(root, { reason: '', count: 0 });
  return systemMessage ? { systemMessage } : null;
}

export { closingChecks, turnFiles };
