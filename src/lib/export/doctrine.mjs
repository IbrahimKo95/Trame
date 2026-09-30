// Export Doctrine ORM : entités PHP 8 avec attributs.
import {
  planRelations, planOrder, pkColumns, isAuto, isRequired, normAction, parseDefault,
  oneLine, tName, cName, pascal, singular, columnById,
} from './types.mjs';

const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const MAP = {
  increments: ['Types::INTEGER', 'int'],
  bigIncrements: ['Types::BIGINT', 'string'],
  integer: ['Types::INTEGER', 'int'],
  bigInteger: ['Types::BIGINT', 'string'],
  smallInteger: ['Types::SMALLINT', 'int'],
  decimal: ['Types::DECIMAL', 'string'],
  float: ['Types::FLOAT', 'float'],
  boolean: ['Types::BOOLEAN', 'bool'],
  string: ['Types::STRING', 'string'],
  text: ['Types::TEXT', 'string'],
  uuid: ['Types::GUID', 'string'],
  date: ['Types::DATE_MUTABLE', '\\DateTimeInterface'],
  datetime: ['Types::DATETIME_MUTABLE', '\\DateTimeInterface'],
  timestamp: ['Types::DATETIME_MUTABLE', '\\DateTimeInterface'],
  time: ['Types::TIME_MUTABLE', '\\DateTimeInterface'],
  json: ['Types::JSON', 'array'],
  enum: ['Types::STRING', 'string'],
  binary: ['Types::BINARY', 'mixed'],
};

const ON_DELETE = { cascade: 'CASCADE', 'set null': 'SET NULL', restrict: 'RESTRICT', 'set default': 'SET DEFAULT' };

function optionsFor(c) {
  const opts = [];
  const p = parseDefault(c.default);
  let unmapped = null;
  if (p && p.kind !== 'null') {
    if (p.kind === 'bool') opts.push(`'default' => ${p.value}`);
    else if (p.kind === 'number') opts.push(`'default' => ${p.value}`);
    else if (p.kind === 'string') opts.push(`'default' => ${phpStr(p.value)}`);
    else if (p.kind === 'now') opts.push("'default' => 'CURRENT_TIMESTAMP'");
    else unmapped = p.raw;
  }
  if (c.comment) opts.push(`'comment' => ${phpStr(oneLine(c.comment))}`);
  return { opts, unmapped };
}

/** Exporte un schéma en entités Doctrine : [{ filename, content }]. */
export function toDoctrine(schema) {
  const { models, rels } = planRelations(schema);
  const { ordered } = planOrder(schema);
  const files = [];

  for (const t of ordered) {
    const m = models.get(t.id);
    const cols = t.columns ?? [];
    const pks = pkColumns(t);
    const props = []; // { decl: [lines], name, phpType, nullable, kind, ... }
    const ctorInit = [];
    const methods = [];
    const relFromCol = new Map(rels.filter((r) => r.from.id === t.id).map((r) => [r.col.id, r]));

    for (const c of cols) {
      const rel = relFromCol.get(c.id);
      if (rel) continue; // traité comme association plus bas
      const [dt, php] = MAP[c.type] ?? ['Types::STRING', 'string'];
      const name = m.fields.get(c.id);
      const args = [];
      if (name !== cName(c)) args.push(`name: ${phpStr(cName(c))}`);
      args.push(`type: ${dt}`);
      if (c.type === 'string' || (c.type === 'enum')) {
        const len = Number.isInteger(c.length) && c.length > 0 ? c.length : 255;
        if (len !== 255) args.push(`length: ${len}`);
      }
      if (c.type === 'decimal') {
        args.push(`precision: ${Number.isInteger(c.precision) && c.precision > 0 ? c.precision : 10}`);
        args.push(`scale: ${Number.isInteger(c.scale) && c.scale >= 0 ? c.scale : 2}`);
      }
      const nullable = !isRequired(c);
      if (nullable) args.push('nullable: true');
      if (c.unique && !(c.pk && pks.length === 1)) args.push('unique: true');
      const { opts, unmapped } = optionsFor(c);
      if (opts.length && !isAuto(c)) args.push(`options: [${opts.join(', ')}]`);
      const decl = [];
      if (unmapped) decl.push(`// Défaut SQL non mappé : ${oneLine(unmapped)}`);
      if (c.pk) decl.push('#[ORM\\Id]');
      if (c.pk && pks.length === 1 && isAuto(c)) decl.push('#[ORM\\GeneratedValue]');
      decl.push(`#[ORM\\Column(${args.join(', ')})]`);
      const isNull = nullable || (c.pk && isAuto(c) && pks.length === 1);
      const typeStr = php === 'mixed' ? 'mixed' : `${isNull ? '?' : ''}${php}`;
      decl.push(`private ${typeStr} $${name}${isNull ? ' = null' : ''};`);
      props.push(decl);
      const isBool = php === 'bool';
      const getter = isBool ? (/^is[A-Z]/.test(name) ? name : `is${cap(name)}`) : `get${cap(name)}`;
      const setType = php === 'mixed' ? 'mixed' : `${isNull ? '?' : ''}${php}`;
      methods.push(`    public function ${getter}(): ${typeStr}\n    {\n        return $this->${name};\n    }`);
      if (!(c.pk && isAuto(c))) {
        methods.push(`    public function set${cap(name)}(${setType} $${name}): static\n    {\n        $this->${name} = $${name};\n\n        return $this;\n    }`);
      }
    }

    // associations côté propriétaire (FK)
    for (const r of rels.filter((x) => x.from.id === t.id)) {
      const c = r.col;
      const kind = r.one ? 'OneToOne' : 'ManyToOne';
      const assoc = [`targetEntity: ${r.toModel}::class`];
      if (r.inverse) assoc.push(`inversedBy: ${phpStr(r.inverse)}`);
      const join = [`name: ${phpStr(cName(c))}`, `referencedColumnName: ${phpStr(cName(r.refCol))}`];
      if (!r.optional) join.push('nullable: false');
      const del = normAction(c.ref.onDelete);
      if (ON_DELETE[del]) join.push(`onDelete: ${phpStr(ON_DELETE[del])}`);
      const decl = [];
      if (c.pk) decl.push('#[ORM\\Id]');
      decl.push(`#[ORM\\${kind}(${assoc.join(', ')})]`, `#[ORM\\JoinColumn(${join.join(', ')})]`);
      decl.push(`private ?${r.toModel} $${r.field} = null;`);
      props.push(decl);
      methods.push(
        `    public function get${cap(r.field)}(): ?${r.toModel}\n    {\n        return $this->${r.field};\n    }`,
        `    public function set${cap(r.field)}(${r.optional ? '?' : ''}${r.toModel} $${r.field}): static\n    {\n        $this->${r.field} = $${r.field};\n\n        return $this;\n    }`,
      );
    }

    // associations inverses
    for (const r of rels.filter((x) => x.to.id === t.id)) {
      if (r.one) {
        props.push([
          `#[ORM\\OneToOne(targetEntity: ${r.fromModel}::class, mappedBy: ${phpStr(r.field)})]`,
          `private ?${r.fromModel} $${r.inverse} = null;`,
        ]);
        methods.push(
          `    public function get${cap(r.inverse)}(): ?${r.fromModel}\n    {\n        return $this->${r.inverse};\n    }`,
          `    public function set${cap(r.inverse)}(?${r.fromModel} $${r.inverse}): static\n    {\n        $this->${r.inverse} = $${r.inverse};\n\n        return $this;\n    }`,
        );
      } else {
        const item = pascal(singular(r.inverse)) || cap(r.inverse);
        const v = r.fromModel.charAt(0).toLowerCase() + r.fromModel.slice(1);
        props.push([
          `/** @var Collection<int, ${r.fromModel}> */`,
          `#[ORM\\OneToMany(targetEntity: ${r.fromModel}::class, mappedBy: ${phpStr(r.field)})]`,
          `private Collection $${r.inverse};`,
        ]);
        ctorInit.push(`        $this->${r.inverse} = new ArrayCollection();`);
        const ownerSet = `set${cap(r.field)}`;
        const ownerGet = `get${cap(r.field)}`;
        methods.push(
          `    /**\n     * @return Collection<int, ${r.fromModel}>\n     */\n    public function get${cap(r.inverse)}(): Collection\n    {\n        return $this->${r.inverse};\n    }`,
          `    public function add${item}(${r.fromModel} $${v}): static\n    {\n        if (!$this->${r.inverse}->contains($${v})) {\n            $this->${r.inverse}->add($${v});\n            $${v}->${ownerSet}($this);\n        }\n\n        return $this;\n    }`,
          r.optional
            ? `    public function remove${item}(${r.fromModel} $${v}): static\n    {\n        if ($this->${r.inverse}->removeElement($${v})) {\n            if ($${v}->${ownerGet}() === $this) {\n                $${v}->${ownerSet}(null);\n            }\n        }\n\n        return $this;\n    }`
            : `    public function remove${item}(${r.fromModel} $${v}): static\n    {\n        $this->${r.inverse}->removeElement($${v});\n\n        return $this;\n    }`,
        );
      }
    }

    const uses = props.some((d) => d.some((l) => l.includes('Types::'))) ? ['use Doctrine\\DBAL\\Types\\Types;'] : [];
    if (ctorInit.length) uses.unshift('use Doctrine\\Common\\Collections\\ArrayCollection;', 'use Doctrine\\Common\\Collections\\Collection;');
    uses.sort();
    uses.push('use Doctrine\\ORM\\Mapping as ORM;');

    const tableArgs = [`name: ${phpStr(tName(t))}`];
    const idx = [];
    const uniq = [];
    for (const ix of t.indexes ?? []) {
      const names = (ix.columns ?? []).map((id) => columnById(t, id)).filter(Boolean).map(cName);
      if (!names.length) continue;
      const a = `${ix.name ? `name: ${phpStr(ix.name)}, ` : ''}columns: [${names.map(phpStr).join(', ')}]`;
      (ix.unique ? uniq : idx).push(`new ORM\\${ix.unique ? 'UniqueConstraint' : 'Index'}(${a})`);
    }
    if (idx.length) tableArgs.push(`indexes: [${idx.join(', ')}]`);
    if (uniq.length) tableArgs.push(`uniqueConstraints: [${uniq.join(', ')}]`);
    const out = [];
    out.push('<?php', '', 'declare(strict_types=1);', '', 'namespace App\\Entity;', '', ...uses, '');
    if (t.comment) out.push(`/** ${oneLine(t.comment).replace(/\*\//g, '* /')} */`);
    out.push('#[ORM\\Entity]', `#[ORM\\Table(${tableArgs.join(', ')})]`, `class ${m.name}`, '{');
    const body = [];
    props.forEach((decl) => body.push(decl.map((l) => '    ' + l).join('\n')));
    let text = out.join('\n') + '\n' + body.join('\n\n');
    if (ctorInit.length) {
      text += `\n\n    public function __construct()\n    {\n${ctorInit.join('\n')}\n    }`;
    }
    if (methods.length) text += '\n\n' + methods.join('\n\n');
    text += '\n}\n';
    files.push({ filename: `${m.name}.php`, content: text });
  }
  return files;
}
