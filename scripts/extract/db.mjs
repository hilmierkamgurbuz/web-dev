import { calleeChain, collapse, decoratorInfo, decoratorsOf, literalText, objectProp, plainChain, propName, unwrap } from './ast.mjs';

const NESTED_WRITES = new Set(['create', 'createMany', 'connectOrCreate', 'upsert', 'update', 'updateMany', 'delete', 'deleteMany', 'set', 'disconnect']);

const PRISMA_READ = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);
const PRISMA_WRITE = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany']);
const MODEL_READ = new Set(['find', 'findOne', 'findById', 'findAll', 'findByPk', 'findAndCountAll', 'countDocuments', 'count', 'aggregate', 'exists', 'distinct', 'findOneBy', 'findBy']);
const MODEL_WRITE = new Set(['create', 'insertMany', 'updateOne', 'updateMany', 'findByIdAndUpdate', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findByIdAndDelete', 'findOneAndDelete', 'bulkWrite', 'bulkCreate', 'destroy', 'upsert', 'save', 'insert', 'update', 'delete', 'remove', 'softDelete']);
const DRIZZLE_WRITE = new Set(['insert', 'update', 'delete']);
const DRIZZLE_READ = new Set(['from', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin']);
const KNEX_WRITE = new Set(['insert', 'update', 'del', 'delete', 'truncate', 'upsert', 'merge']);

function firstIdentifier(ts, node) {
  const n = unwrap(ts, node);
  return n && ts.isIdentifier(n) ? n.text : null;
}

export function inspectDbCall(ts, sf, call, ctx) {
  const chain = calleeChain(ts, call.expression);
  const plain = plainChain(chain);
  const last = plain[plain.length - 1];
  const out = [];
  if (!last) return out;
  const hasTag = (tag) => ctx.tags.includes(tag);

  if (hasTag('prisma') && plain.length >= 3 && (PRISMA_READ.has(last) || PRISMA_WRITE.has(last))) {
    const entity = plain[plain.length - 2];
    if (!entity.startsWith('$')) {
      out.push({ op: PRISMA_WRITE.has(last) ? 'w' : 'r', entity, via: 'prisma' });
      const data = PRISMA_WRITE.has(last) && call.arguments[0] ? unwrap(ts, objectProp(ts, sf, call.arguments[0], last === 'upsert' ? 'create' : 'data')) : null;
      if (data && ts.isObjectLiteralExpression(data)) {
        for (const prop of data.properties) {
          if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
          const value = unwrap(ts, prop.initializer);
          if (value && ts.isObjectLiteralExpression(value) && value.properties.some((p) => p.name && NESTED_WRITES.has(propName(ts, sf, p.name)))) {
            out.push({ op: 'w', entity: `${entity}.${propName(ts, sf, prop.name)}`, via: 'prisma-nested' });
          }
        }
      }
    }
  }
  if (hasTag('drizzle')) {
    if (DRIZZLE_WRITE.has(last) && call.arguments.length === 1) {
      const table = firstIdentifier(ts, call.arguments[0]);
      if (table) out.push({ op: 'w', entity: table, via: 'drizzle' });
    }
    if (DRIZZLE_READ.has(last) && call.arguments.length >= 1) {
      const table = firstIdentifier(ts, call.arguments[0]);
      if (table) out.push({ op: 'r', entity: table, via: 'drizzle' });
    }
    const q = plain.indexOf('query');
    if (q !== -1 && plain.length === q + 3 && /^find(Many|First)$/.test(last)) out.push({ op: 'r', entity: plain[q + 1], via: 'drizzle' });
  }
  if ((hasTag('mongoose') || hasTag('sequelize') || hasTag('typeorm')) && plain.length === 2 && /^[A-Z]/.test(plain[0]) && (MODEL_READ.has(last) || MODEL_WRITE.has(last))) {
    out.push({ op: MODEL_WRITE.has(last) ? 'w' : 'r', entity: plain[0], via: 'model' });
  }
  if (hasTag('typeorm')) {
    const repoIndex = plain.findIndex((p) => ctx.repos.has(p));
    if (repoIndex !== -1 && repoIndex === plain.length - 2 && (MODEL_READ.has(last) || MODEL_WRITE.has(last))) {
      out.push({ op: MODEL_WRITE.has(last) ? 'w' : 'r', entity: ctx.repos.get(plain[repoIndex]), via: 'typeorm' });
    }
    if (chain.includes('getRepository')) {
      const inner = unwrap(ts, call.expression);
      const repoCall = inner && ts.isPropertyAccessExpression(inner) ? unwrap(ts, inner.expression) : null;
      if (repoCall && ts.isCallExpression(repoCall)) {
        const entity = firstIdentifier(ts, repoCall.arguments[0]);
        if (entity && (MODEL_READ.has(last) || MODEL_WRITE.has(last))) out.push({ op: MODEL_WRITE.has(last) ? 'w' : 'r', entity, via: 'typeorm' });
      }
    }
  }
  if (hasTag('knex') && chain[1] === '()' && plain.length >= 2) {
    const inner = unwrap(ts, call.expression);
    let base = inner;
    while (base && ts.isPropertyAccessExpression(base)) base = unwrap(ts, base.expression);
    while (base && ts.isCallExpression(base) && ts.isPropertyAccessExpression(unwrap(ts, base.expression))) {
      base = unwrap(ts, unwrap(ts, base.expression).expression);
    }
    if (base && ts.isCallExpression(base) && ts.isIdentifier(unwrap(ts, base.expression))) {
      const table = literalText(ts, base.arguments[0]);
      if (table) out.push({ op: KNEX_WRITE.has(last) ? 'w' : 'r', entity: table, via: 'knex' });
    }
  }
  return out;
}

const SQL_HINT = /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set)\b/i;

export function inspectSqlText(text) {
  if (!SQL_HINT.test(text)) return [];
  const out = [];
  const add = (op, name) => {
    const entity = name.replace(/["`\[\]]/g, '').split('.').pop();
    if (entity && !/^(select|where|set|values)$/i.test(entity)) out.push({ op, entity, via: 'sql' });
  };
  for (const m of text.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+([`"\[\]\w.]+)/gi)) add('w', m[1]);
  for (const m of text.matchAll(/\b(?:from|join)\s+([`"\[\]\w.]+)/gi)) {
    const before = text.slice(0, m.index);
    if (/delete\s*$/i.test(before)) continue;
    add('r', m[1]);
  }
  return out;
}

export function parsePrisma(text) {
  const models = [];
  const re = /^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm;
  let match;
  while ((match = re.exec(text))) {
    const body = match[2];
    const fields = [];
    let table = match[1];
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//')) continue;
      const map = /^@@map\(\s*"([^"]+)"/.exec(t);
      if (map) {
        table = map[1];
        continue;
      }
      if (t.startsWith('@@')) continue;
      const field = /^(\w+)\s+([\w\[\]?]+)(.*)$/.exec(t);
      if (field) fields.push({ name: field[1], type: field[2], attrs: collapse(field[3].replace(/\/\/.*$/, ''), 80) });
    }
    models.push({ name: match[1], table, columns: fields });
  }
  const enums = [...text.matchAll(/^\s*enum\s+(\w+)/gm)].map((m) => m[1]);
  return { kind: 'prisma', models, enums };
}

export function parseSqlSchema(text) {
  const tables = [];
  for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([`"\[\]\w.]+)\s*\(([\s\S]*?)\);/gi)) {
    const name = m[1].replace(/["`\[\]]/g, '').split('.').pop();
    const columns = m[2]
      .split(/,\s*\n/)
      .map((c) => c.trim())
      .filter((c) => c && !/^(constraint|primary|foreign|unique|check)\b/i.test(c))
      .map((c) => {
        const parts = c.split(/\s+/);
        return { name: parts[0].replace(/["`\[\]]/g, ''), type: parts[1] || '', attrs: collapse(parts.slice(2).join(' '), 60) };
      });
    tables.push({ name, table: name, columns });
  }
  const alters = [...text.matchAll(/alter\s+table\s+([`"\[\]\w.]+)\s+add\s+(?:column\s+)?([`"\w]+)\s+(\w+)/gi)].map((m) => ({
    table: m[1].replace(/["`\[\]]/g, '').split('.').pop(),
    column: m[2].replace(/["`]/g, ''),
    type: m[3],
  }));
  return { kind: 'sql', models: tables, alters };
}

const TABLE_FACTORIES = new Set(['pgTable', 'mysqlTable', 'sqliteTable', 'singlestoreTable']);

export function inspectTableDeclaration(ts, sf, decl) {
  const init = unwrap(ts, decl.initializer);
  if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(decl.name)) return null;
  const factory = plainChain(calleeChain(ts, init.expression)).pop();
  if (TABLE_FACTORIES.has(factory)) {
    const table = literalText(ts, init.arguments[0]);
    const cols = unwrap(ts, init.arguments[1]);
    const columns = cols && ts.isObjectLiteralExpression(cols)
      ? cols.properties.filter((p) => p.name).map((p) => ({ name: propName(ts, sf, p.name), type: ts.isPropertyAssignment(p) ? plainChain(calleeChain(ts, ts.isCallExpression(unwrap(ts, p.initializer)) ? unwrap(ts, p.initializer).expression : p.initializer))[0] || '' : '', attrs: '' }))
      : [];
    return table ? { kind: 'drizzle', name: decl.name.text, table, columns } : null;
  }
  if (factory === 'model' || factory === 'mongoose.model') {
    const name = literalText(ts, init.arguments[0]);
    return name ? { kind: 'mongoose', name: decl.name.text, table: name, columns: [] } : null;
  }
  return null;
}

export function inspectEntityClass(ts, sf, cls) {
  const decorators = decoratorsOf(ts, cls).map((d) => decoratorInfo(ts, sf, d));
  const entity = decorators.find((d) => d.name === 'Entity' || d.name === 'Table');
  if (!entity || !cls.name) return null;
  let table = cls.name.text;
  const arg = entity.args[0];
  if (arg) {
    const literal = literalText(ts, arg);
    if (literal) table = literal;
  }
  const columns = [];
  for (const member of cls.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue;
    const decos = decoratorsOf(ts, member).map((d) => d.name || decoratorInfo(ts, sf, d).name);
    if (decos.length) columns.push({ name: propName(ts, sf, member.name), type: member.type ? collapse(member.type.getText(sf), 40) : '', attrs: decos.join(',') });
  }
  return { kind: 'typeorm', name: cls.name.text, table, columns };
}

export function repositoryParams(ts, sf, cls) {
  const repos = new Map();
  for (const member of cls.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
    for (const param of member.parameters) {
      const inject = decoratorsOf(ts, param).map((d) => decoratorInfo(ts, sf, d)).find((d) => d.name === 'InjectRepository' || d.name === 'InjectModel');
      if (inject && ts.isIdentifier(param.name)) {
        const entity = unwrap(ts, inject.args[0]);
        if (entity) repos.set(param.name.text, ts.isIdentifier(entity) ? entity.text : literalText(ts, entity) || entity.getText(sf));
      }
    }
  }
  return repos;
}
