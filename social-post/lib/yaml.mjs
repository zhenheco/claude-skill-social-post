function stripComment(line) {
  let quoted = false;
  let out = '';
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    if (char === '#' && !quoted) return out.endsWith(' ') ? out.trimEnd() : out;
    out += char;
  }
  return out;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '') return {};
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (trimmed === '{}') return {};
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return JSON.parse(trimmed);
  return trimmed;
}

function scalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') throw new Error(`unsupported YAML scalar: ${typeof value}`);
  if (
    value &&
    !['null', 'true', 'false'].includes(value) &&
    !/^-?\d+(\.\d+)?$/.test(value) &&
    /^[A-Za-z0-9_.-]+(?: [A-Za-z0-9_.-]+)*$/.test(value)
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function dumpValue(key, value, indent) {
  const pad = ' '.repeat(indent);
  if (isScalar(value)) return [`${pad}${key}: ${scalar(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    const lines = [`${pad}${key}:`];
    for (const item of value) {
      if (isScalar(item)) {
        lines.push(`${pad}  - ${scalar(item)}`);
        continue;
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('unsupported YAML array item');
      const entries = Object.entries(item);
      if (entries.length === 0) {
        lines.push(`${pad}  - {}`);
        continue;
      }
      const [[firstKey, firstValue], ...rest] = entries;
      if (!isScalar(firstValue)) throw new Error('unsupported nested YAML array item');
      lines.push(`${pad}  - ${firstKey}: ${scalar(firstValue)}`);
      for (const [childKey, childValue] of rest) {
        if (!isScalar(childValue)) throw new Error('unsupported nested YAML array item');
        lines.push(`${pad}    ${childKey}: ${scalar(childValue)}`);
      }
    }
    return lines;
  }
  if (value && typeof value === 'object') {
    const lines = [`${pad}${key}:`];
    for (const [childKey, childValue] of Object.entries(value)) {
      lines.push(...dumpValue(childKey, childValue, indent + 2));
    }
    return lines;
  }
  throw new Error(`unsupported YAML value for ${key}`);
}

export function dump(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) lines.push(...dumpValue(key, value, 0));
  return `${lines.join('\n')}\n`;
}

export function parse(content) {
  const root = {};
  const stack = [{ indent: -1, value: root, parent: null, key: null }];

  function normalizeContainer(entry, nextType) {
    if (nextType === 'array' && !Array.isArray(entry.value)) {
      if (entry.value && typeof entry.value === 'object' && Object.keys(entry.value).length === 0 && entry.parent) {
        const next = [];
        entry.parent[entry.key] = next;
        entry.value = next;
      }
    }
    return entry.value;
  }

  for (const line of content.split(/\r?\n/).map(stripComment)) {
    if (!line.trim()) continue;

    const list = line.match(/^(\s*)-\s*(?:(\w+):\s*)?(.*)$/);
    if (list) {
      const indent = list[1].length;
      while (stack.at(-1).indent >= indent) stack.pop();
      const parentEntry = stack.at(-1);
      const parent = normalizeContainer(parentEntry, 'array');
      if (!Array.isArray(parent)) continue;
      const value = list[2] ? { [list[2]]: parseScalar(list[3]) } : parseScalar(list[3]);
      parent.push(value);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        stack.push({ indent, value, parent, key: parent.length - 1 });
      }
      continue;
    }

    const entry = line.match(/^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/);
    if (entry) {
      const indent = entry[1].length;
      while (stack.at(-1).indent >= indent) stack.pop();
      const parent = normalizeContainer(stack.at(-1), 'object');
      if (!parent || typeof parent !== 'object' || Array.isArray(parent)) continue;
      const key = entry[2];
      const value = parseScalar(entry[3]);
      parent[key] = value;
      if (value && typeof value === 'object') stack.push({ indent, value, parent, key });
      continue;
    }
  }
  return root;
}
