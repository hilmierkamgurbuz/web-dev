import { checkBlueprint } from '../check_blueprint.mjs';
import { checkDocs } from '../check_docs.mjs';
import { readJson, writeJson } from './io.mjs';
import { layout } from './paths.mjs';

export function allChecks(root) {
  const blueprint = checkBlueprint(root);
  return [...blueprint.findings, ...checkDocs(root)];
}

function keyOf(finding) {
  return `${finding.code}|${finding.message}`;
}

export function snapshotBaseline(root) {
  const errors = allChecks(root).filter((f) => f.level === 'ERROR').map(keyOf);
  writeJson(`${layout(root).state}/check-baseline.json`, { at: new Date().toISOString(), errors });
  return errors;
}

export function newErrors(root) {
  const baseline = new Set(readJson(`${layout(root).state}/check-baseline.json`, { errors: [] })?.errors || []);
  const findings = allChecks(root);
  const errors = findings.filter((f) => f.level === 'ERROR');
  return { introduced: errors.filter((f) => !baseline.has(keyOf(f))), preexisting: errors.filter((f) => baseline.has(keyOf(f))), findings };
}
