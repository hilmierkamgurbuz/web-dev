import { owedFor, renderMaps } from '../build_maps.mjs';
import { checkDocs } from '../check_docs.mjs';
import { loadConfig } from '../lib/config.mjs';
import { context, WD } from '../lib/hookio.mjs';
import { lockfiles } from '../lib/lockfile.mjs';
import { isAnalyzable } from '../lib/project.mjs';
import { detectStack } from '../lib/stack.mjs';
import { clearDirty, readDirty, readTurn } from '../lib/state.mjs';
import { dependencyAudit } from '../security/external.mjs';

export default async function ({ root }) {
  const dirty = readDirty(root);
  if (!dirty.paths.length && !dirty.deps && !dirty.tree) return null;

  const config = loadConfig(root);
  const notes = [];

  if (dirty.tree || dirty.paths.length) {
    try {
      const health = renderMaps(root);
      if (health.status && health.status !== 'OK') {
        notes.push(`maps: ${health.status} · ${health.counts?.unmatched || 0} unmatched call(s), ${health.counts?.unresolved || 0} unresolved`);
      }
    } catch (error) {
      notes.push(`maps: render failed — ${error.message}`);
    }
  }

  const written = readTurn(root).writes || [];
  const analyzable = written.filter((rel) => isAnalyzable(rel, config));
  if (analyzable.length) {
    const result = owedFor(root, analyzable);
    if (result.ok && result.owed.length) {
      const lines = result.owed.slice(0, 12).map((o) => `- ${o.key} (${o.marker}${o.header ? ': role, sys, crit' : ''})`);
      notes.push(`notes owed this turn — write them now with ${WD} note set:\n${lines.join('\n')}${result.owed.length > 12 ? `\n- …${result.owed.length - 12} more (${WD} note missing --turn)` : ''}`);
    }
  }

  if (dirty.deps) {
    for (const f of checkDocs(root).filter((f) => /^DOCS-(STACK|FACT)/.test(f.code)).slice(0, 6)) notes.push(`${f.level} ${f.message}`);
    const audit = dependencyAudit(root, lockfiles(root, detectStack(root).workspaces), config);
    if (audit.available && audit.findings.length) {
      notes.push(`osv-scanner: ${audit.findings.length} known vulnerabilit${audit.findings.length > 1 ? 'ies' : 'y'} — ${audit.findings.slice(0, 5).map((f) => `${f.package} ${f.id}`).join(', ')}`);
    }
  }

  clearDirty(root);
  return notes.length ? context('PostToolBatch', `web-dev: ${notes.join('\n')}`) : null;
}
