function stripComment(line) {
  let quoted = false;
  return [...line].reduce((out, char) => {
    if (char === '"') quoted = !quoted;
    if (char === '#' && !quoted) return out.endsWith(' ') ? out.trimEnd() : out;
    return out + char;
  }, '');
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '') return {};
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
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
  let section = null;
  let item = null;
  for (const line of content.split(/\r?\n/).map(stripComment)) {
    if (!line.trim()) continue;
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      section = top[1];
      item = null;
      root[section] = parseScalar(top[2]);
      continue;
    }
    const list = line.match(/^  -\s*(?:(\w+):\s*)?(.*)$/);
    if (list && section) {
      if (!Array.isArray(root[section])) root[section] = [];
      item = list[1] ? { [list[1]]: parseScalar(list[2]) } : parseScalar(list[2]);
      root[section].push(item);
      continue;
    }
    const child = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (child && section) {
      if (!root[section] || Array.isArray(root[section])) root[section] = {};
      root[section][child[1]] = parseScalar(child[2]);
      continue;
    }
    const itemChild = line.match(/^    ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (itemChild && item && typeof item === 'object') item[itemChild[1]] = parseScalar(itemChild[2]);
  }
  return root;
}
