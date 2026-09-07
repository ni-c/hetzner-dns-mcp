import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CallToolResult } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALL_TOOLS, ESSENTIAL_TOOLS } from '../src/tools/catalogue.js';
import {
  asksAPerson,
  connectClient,
  jsonResponse,
  stubFetch,
} from './harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The tool reference is written by hand, so this is what stops it drifting from
 * the catalogue.
 *
 * The alternative — generating the page — buys the same guarantee at the cost of
 * a generator nobody reads and prose nobody can edit, and the prose is most of
 * the value: what the endpoint behind a tool does that its name does not
 * promise, which parameter combination it silently resolves its own way, which
 * default would be dangerous. A test that fails by name when a tool is added,
 * renamed, moved into the preset or loses its confirmation guard is the cheaper
 * half of it, and it fails in the same run as everything else.
 */
function read(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    'utf8'
  );
}

const reference = read('docs/reference/tools.md');

/**
 * Markers and the kind word some servers put after the name. Both decorate the
 * heading; neither is part of it.
 */
const MARKERS =
  /[\u{1F464}\u{1F511}\u{1F194}\u2605]|<Badge[^>]*\/?>|<\/Badge>|\b(?:read-only|read|write|destructive)\b/gu;

/**
 * The tools a heading names — none, if the heading is prose.
 *
 * The family writes this page in more than one shape: `### \`tool\``, plain
 * `## tool`, and one heading for a pair (`### \`enable_x\` / \`disable_x\``).
 * What they have in common is that a tool heading carries *nothing but* the
 * names, so `## The \`essential\` preset` drops out on its own rather than
 * being read as a tool called `essential`.
 */
function headingTools(heading: string): string[] {
  const clean = heading.replace(MARKERS, '').trim();
  const spans = [...clean.matchAll(/`([a-z][a-z0-9_]*)`/g)].map(
    (match) => match[1] as string
  );
  if (spans.length > 0) {
    const rest = clean.replace(/`[a-z][a-z0-9_]*`/g, '').replace(/[\s/,]/g, '');
    return rest === '' ? spans : [];
  }
  const bare = clean.split('/').map((part) => part.trim());
  return bare.every((part) => /^[a-z][a-z0-9_]*$/.test(part)) ? bare : [];
}

/**
 * Tools listed in a table rather than in sections.
 *
 * Keyed on a first column headed `Tool`, which is what separates the tool table
 * from the parameter tables further down — those are headed `Parameter`.
 */
function tableTools(markdown: string): string[] {
  const names: string[] = [];
  let inToolTable = false;
  for (const line of markdown.split('\n')) {
    if (/^\|\s*Tool\s*\|/.test(line)) {
      inToolTable = true;
      continue;
    }
    if (!line.startsWith('|')) {
      inToolTable = false;
      continue;
    }
    if (!inToolTable || /^\|[\s|:-]+\|$/.test(line)) continue;
    const match = /`([a-z][a-z0-9_]*)`/.exec(line.split('|')[1] ?? '');
    if (match) names.push(match[1] as string);
  }
  return names;
}

/**
 * Every tool the page documents, in the order it lists them.
 *
 * De-duplicated: several servers list their tools in an overview table *and*
 * give each one a section, and a tool named twice is documented once.
 */
function documentedTools(markdown: string): string[] {
  const headings = [...markdown.matchAll(/^#{2,4} +(.+)$/gm)].flatMap(
    ([, heading]) => headingTools(heading as string)
  );
  return [...new Set([...headings, ...tableTools(markdown)])];
}

/** What the page says about each tool: its section, or its row in the table. */
function bodyByTool(markdown: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const headings = [...markdown.matchAll(/^#{2,4} +(.+)$/gm)];
  for (const [index, match] of headings.entries()) {
    // From the heading itself, not after it: several servers put the markers on
    // the heading line (`### \`delete_link\` 👤`) rather than in the body.
    const start = match.index as number;
    const end =
      (headings[index + 1]?.index as number | undefined) ?? markdown.length;
    const body = markdown.slice(start, end);
    for (const name of headingTools(match[1] as string)) {
      bodies.set(name, (bodies.get(name) ?? '') + body);
    }
  }
  // A marker may sit in the overview row rather than in the section, so the row
  // counts as part of what the page says about that tool.
  const fromTable = new Set(tableTools(markdown));
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const match = /`([a-z][a-z0-9_]*)`/.exec(line.split('|')[1] ?? '');
    if (match && fromTable.has(match[1] as string)) {
      const name = match[1] as string;
      bodies.set(name, (bodies.get(name) ?? '') + line);
    }
  }
  return bodies;
}

function marked(markdown: string, marker: RegExp): string[] {
  return [...bodyByTool(markdown)]
    .filter(([, body]) => marker.test(body))
    .map(([name]) => name);
}

/**
 * Every call that must raise a dialog, and every call that must not.
 *
 * Driven through the server rather than read off a list, because the four
 * conditional guards here — `create_zone` on its payload, `create_rrset` and
 * `add_records` on the name and type, the two `change_*_protection` on the
 * direction — are exactly the ones a hand-kept list gets wrong. The page marks
 * a *tool*, so a tool with a conditional guard is marked and its condition is
 * described in the prose; what this asserts is that the marked set and the set
 * that actually asks are the same.
 */
const ASKS: { name: string; arguments: Record<string, unknown> }[] = [
  { name: 'delete_zone', arguments: { zone: 'example.com' } },
  {
    name: 'import_zonefile',
    arguments: { zone: 'example.com', zonefile: '@ IN NS ns1.example.com.\n' },
  },
  {
    name: 'change_zone_protection',
    arguments: { zone: 'example.com', delete: false },
  },
  {
    name: 'change_primary_nameservers',
    arguments: {
      zone: 'example.com',
      primary_nameservers: [{ address: '198.51.100.9' }],
    },
  },
  {
    name: 'create_zone',
    arguments: {
      name: 'example.com',
      mode: 'primary',
      zonefile: '@ IN NS ns1.example.com.\n',
    },
  },
  {
    name: 'delete_rrset',
    arguments: { zone: 'example.com', name: 'www', type: 'A' },
  },
  {
    name: 'set_records',
    arguments: {
      zone: 'example.com',
      name: 'www',
      type: 'A',
      records: [{ value: '198.51.100.1' }],
    },
  },
  {
    name: 'remove_records',
    arguments: {
      zone: 'example.com',
      name: 'www',
      type: 'A',
      records: [{ value: '198.51.100.1' }],
    },
  },
  {
    name: 'change_rrset_protection',
    arguments: { zone: 'example.com', name: 'www', type: 'A', change: false },
  },
  {
    name: 'create_rrset',
    arguments: {
      zone: 'example.com',
      name: 'sub',
      type: 'NS',
      records: [{ value: 'ns1.example.net.' }],
    },
  },
  {
    name: 'add_records',
    arguments: {
      zone: 'example.com',
      name: 'sub',
      type: 'MX',
      records: [{ value: '0 mail.example.net.' }],
    },
  },
];

/** The other side of the conditional guards: these must act straight away. */
const DOES_NOT_ASK: { name: string; arguments: Record<string, unknown> }[] = [
  { name: 'create_zone', arguments: { name: 'example.com', mode: 'primary' } },
  {
    name: 'change_zone_protection',
    arguments: { zone: 'example.com', delete: true },
  },
  {
    name: 'change_rrset_protection',
    arguments: { zone: 'example.com', name: 'www', type: 'A', change: true },
  },
  {
    name: 'create_rrset',
    arguments: {
      zone: 'example.com',
      name: 'www',
      type: 'A',
      records: [{ value: '198.51.100.1' }],
    },
  },
  {
    name: 'add_records',
    arguments: {
      zone: 'example.com',
      name: 'www',
      type: 'A',
      records: [{ value: '198.51.100.1' }],
    },
  },
  {
    name: 'change_zone_ttl',
    arguments: { zone: 'example.com', ttl: 3600 },
  },
  {
    name: 'change_rrset_ttl',
    arguments: { zone: 'example.com', name: 'www', type: 'A', ttl: 3600 },
  },
  { name: 'update_zone', arguments: { zone: 'example.com', labels: {} } },
  {
    name: 'update_rrset',
    arguments: { zone: 'example.com', name: 'www', type: 'A', labels: {} },
  },
];

describe('the tool reference', () => {
  it('documents every tool and no tool that does not exist', () => {
    expect(documentedTools(reference).toSorted()).toEqual(ALL_TOOLS.toSorted());
  });

  it('marks exactly the essential preset', () => {
    expect(marked(reference, /\*\*essential\*\*/).toSorted()).toEqual(
      ESSENTIAL_TOOLS.toSorted()
    );
  });

  /**
   * The check this file said belonged back in once a harness existed. It does
   * now, and it caught what the comment predicted: three tools raise a dialog
   * that the page did not mark.
   */
  it('marks exactly the tools that ask a person', async () => {
    stubFetch(() => jsonResponse({ zone: {}, rrset: { records: [] } }));
    const client = await connectClient();

    const asking: string[] = [];
    for (const call of ASKS) {
      const result = (await client.callTool(call)) as CallToolResult;
      if (asksAPerson(result)) asking.push(call.name);
    }
    for (const call of DOES_NOT_ASK) {
      const result = (await client.callTool(call)) as CallToolResult;
      expect(
        asksAPerson(result),
        `${call.name} asked for arguments that should not need it`
      ).toBe(false);
    }

    expect(marked(reference, /👤/).toSorted()).toEqual(
      [...new Set(asking)].toSorted()
    );
  });
});

describe('the fixed cross-document anchors', () => {
  // These headings are linked from several places and are spelled identically in
  // every server of this family, so a rename here quietly breaks links there.
  it('keeps the README anchor for the tool filter', () => {
    expect(read('README.md')).toContain('### Choosing which tools load');
    expect(read('README.md')).toContain('(#choosing-which-tools-load)');
  });

  it('keeps the docs anchor for the tool filter', () => {
    expect(read('docs/guide/configuration.md')).toContain(
      '## Choosing the tools that load'
    );
    // faq.md links it in all nineteen servers. environment.md does so in three,
    // which makes it a good idea rather than the convention — asserting it here
    // would fail sixteen repositories over a link nobody agreed on.
    expect(read('docs/guide/faq.md')).toContain(
      '#choosing-the-tools-that-load'
    );
  });

  it('keeps the changelog include by region, never by line range', () => {
    // A line range depends on how long the file's header happens to be and fails
    // silently when it grows — the newest release simply stops appearing.
    expect(read('docs/reference/changelog.md')).toContain(
      '<!--@include: ../../CHANGELOG.md#changelog-->'
    );
    const changelog = read('CHANGELOG.md');
    expect(changelog).toContain('<!-- #region changelog -->');
    expect(changelog.trimEnd().endsWith('<!-- #endregion changelog -->')).toBe(
      true
    );
  });
});
