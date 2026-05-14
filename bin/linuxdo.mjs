#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { URL } from 'node:url';

function printUsage() {
  console.log(`linuxdo usage:
  linuxdo set-curl --from-file ./request.curl
  linuxdo set-curl "curl 'https://linux.do/t/topic/123' -H 'cookie: ...' -H 'user-agent: ...'"
  linuxdo set-curl --url https://linux.do/t/topic/123 -H 'cookie: ...' -H 'user-agent: ...'
  linuxdo get-topic 111903
  linuxdo get-comments 111903 --from 1 --limit 5

optional:
  --state /custom/path/session.json
  --shape list|tree`);
}

function isInlineCurlOption(token) {
  return token === '-H'
    || token === '--header'
    || token === '-b'
    || token === '--cookie'
    || token === '-A'
    || token === '--user-agent'
    || token === '-e'
    || token === '--referer';
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positionals = [];
  const inlineCurlParts = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];

    if (command === 'set-curl' && isInlineCurlOption(token)) {
      const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : '';
      inlineCurlParts.push(token);
      if (value) {
        inlineCurlParts.push(value);
      }
      continue;
    }

    if (command === 'set-curl' && token === '--url') {
      const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
      options.url = value;
      continue;
    }

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    options[key] = value;
  }

  return { command, options, positionals, inlineCurlParts };
}

function getStatePath(customPath) {
  return customPath ? resolve(customPath) : resolve(homedir(), '.config', 'linuxdo-cli', 'session.json');
}

async function loadState(statePath) {
  const raw = await readFile(statePath, 'utf8');
  const state = JSON.parse(raw);
  if (!state.sourceUrl) {
    throw new Error('Saved session is missing sourceUrl');
  }
  if (!state.headers || typeof state.headers !== 'object') {
    throw new Error('Saved session is missing headers');
  }
  return state;
}

async function saveState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function shellSplit(commandText) {
  const tokens = [];
  let current = '';
  let quote = '';

  for (let i = 0; i < commandText.length; i += 1) {
    const char = commandText[i];

    if (quote) {
      if (char === quote) {
        quote = '';
        continue;
      }
      if (quote === '"' && char === '\\' && i + 1 < commandText.length) {
        current += commandText[i + 1];
        i += 1;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '\'' || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    if (char === '\\' && i + 1 < commandText.length) {
      const next = commandText[i + 1];
      if (next === '\n' || next === '\r') {
        continue;
      }
      current += next;
      i += 1;
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseHeaderValue(headerValue) {
  const separatorIndex = headerValue.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  const name = headerValue.slice(0, separatorIndex).trim().toLowerCase();
  const value = headerValue.slice(separatorIndex + 1).trim();
  if (!name || !value) {
    return null;
  }

  if (name === 'host' || name === 'content-length') {
    return null;
  }

  return [name, value];
}

function parseCurlTokens(tokens, defaults = {}) {
  if (tokens.length === 0) {
    throw new Error('Input is empty');
  }

  const parseStart = tokens[0] === 'curl' ? 1 : 0;
  const headers = {};
  let sourceUrl = defaults.sourceUrl ?? '';

  for (let i = parseStart; i < tokens.length; i += 1) {
    const token = tokens[i];

    if ((token === '-H' || token === '--header') && i + 1 < tokens.length) {
      const parsed = parseHeaderValue(tokens[++i]);
      if (parsed) {
        headers[parsed[0]] = parsed[1];
      }
      continue;
    }

    if ((token === '-b' || token === '--cookie') && i + 1 < tokens.length) {
      headers.cookie = tokens[++i];
      continue;
    }

    if ((token === '-A' || token === '--user-agent') && i + 1 < tokens.length) {
      headers['user-agent'] = tokens[++i];
      continue;
    }

    if ((token === '-e' || token === '--referer') && i + 1 < tokens.length) {
      headers.referer = tokens[++i];
      continue;
    }

    if (token === '--url' && i + 1 < tokens.length) {
      sourceUrl = tokens[++i];
      continue;
    }

    if (token.startsWith('http://') || token.startsWith('https://')) {
      sourceUrl = token;
    }
  }

  if (!sourceUrl) {
    throw new Error('Could not determine a source URL. Provide a full curl command, use --url, or reuse an existing saved source URL.');
  }

  return {
    sourceUrl,
    headers,
    importedAt: new Date().toISOString(),
  };
}

function parseCurlText(curlText, defaults = {}) {
  const normalized = curlText.replace(/\\\r?\n/g, ' ').trim();
  return parseCurlTokens(shellSplit(normalized), defaults);
}

async function resolveExistingState(statePath) {
  try {
    return await loadState(statePath);
  } catch {
    return null;
  }
}

async function buildStateFromSetCurlInput({ options, positionals, inlineCurlParts }) {
  const statePath = getStatePath(options.state);
  const existingState = await resolveExistingState(statePath);
  const fallbackSourceUrl = options.url ?? existingState?.sourceUrl ?? '';

  if (options['from-file']) {
    const curlText = await readFile(resolve(options['from-file']), 'utf8');
    return {
      statePath,
      state: parseCurlText(curlText, { sourceUrl: fallbackSourceUrl }),
    };
  }

  const inlineText = [...positionals, ...inlineCurlParts].join(' ').trim();
  const inlineTokens = [...positionals, ...inlineCurlParts].filter(Boolean);
  if (inlineTokens.length > 0) {
    const hasStructuredInlineFlags = inlineCurlParts.length > 0 || positionals.length > 1;
    return {
      statePath,
      state: hasStructuredInlineFlags
        ? parseCurlTokens(inlineTokens, { sourceUrl: fallbackSourceUrl })
        : parseCurlText(inlineText, { sourceUrl: fallbackSourceUrl }),
    };
  }

  throw new Error('set-curl requires --from-file or inline curl/header arguments');
}

function buildTopicUrl(sourceUrl, topicId) {
  const base = new URL(sourceUrl);
  return new URL(`/t/${topicId}.json?include_raw=1`, base).toString();
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return parsed;
}

async function fetchJson(target, headers) {
  let response;
  try {
    response = await fetch(target, { headers });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url: target,
      contentType: '',
      bodyText: '',
      json: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    url: target,
    contentType: response.headers.get('content-type') ?? '',
    bodyText: text,
    json,
    error: '',
  };
}

async function fetchTopicPayload(state, topicId) {
  return fetchJson(buildTopicUrl(state.sourceUrl, topicId), state.headers);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .map((tag) => (typeof tag?.name === 'string' ? tag.name : null))
    .filter(Boolean);
}

function normalizeTopic(payload) {
  const posts = Array.isArray(payload?.post_stream?.posts) ? payload.post_stream.posts : [];
  const mainPost = posts.find((post) => post?.post_number === 1) ?? posts[0] ?? null;
  return {
    topic: {
      id: payload?.id ?? null,
      title: payload?.title ?? '',
      slug: payload?.slug ?? '',
      created_at: payload?.created_at ?? '',
      last_posted_at: payload?.last_posted_at ?? '',
      tags: normalizeTags(payload?.tags),
      author: {
        id: payload?.details?.created_by?.id ?? null,
        username: payload?.details?.created_by?.username ?? '',
        name: payload?.details?.created_by?.name ?? '',
      },
    },
    engagement: {
      posts_count: payload?.posts_count ?? 0,
      reply_count: payload?.reply_count ?? 0,
      views: payload?.views ?? 0,
      like_count: payload?.like_count ?? 0,
      participant_count: payload?.participant_count ?? 0,
    },
    content: typeof mainPost?.raw === 'string' ? mainPost.raw : '',
  };
}

function getReplyPosts(payload) {
  const posts = Array.isArray(payload?.post_stream?.posts) ? payload.post_stream.posts : [];
  return posts
    .filter((post) => Number(post?.post_number) > 1 && typeof post?.raw === 'string')
    .sort((left, right) => Number(left.post_number) - Number(right.post_number));
}

function buildCommentForest(posts) {
  const nodes = posts.map((post) => ({
    post_number: post.post_number,
    reply_to_post_number: post.reply_to_post_number ?? null,
    content: post.raw,
    children: [],
  }));

  const byPostNumber = new Map(nodes.map((node) => [node.post_number, node]));
  const roots = [];

  for (const node of nodes) {
    const parent = node.reply_to_post_number ? byPostNumber.get(node.reply_to_post_number) : null;
    if (parent) {
      parent.children.push(node);
      continue;
    }
    roots.push(node);
  }

  return roots;
}

function normalizeComments(payload, options) {
  const from = toPositiveInteger(options.from ?? 1, 1);
  const limit = toPositiveInteger(options.limit ?? 20, 20);
  const shape = options.shape === 'tree' ? 'tree' : 'list';
  const replies = getReplyPosts(payload);
  const startIndex = from - 1;
  const selected = replies.slice(startIndex, startIndex + limit);
  const comments = shape === 'tree'
    ? buildCommentForest(selected)
    : selected.map((post) => post.raw);

  return {
    topic_id: payload?.id ?? null,
    from,
    limit,
    returned: selected.length,
    available_in_window: replies.length,
    shape,
    comments,
  };
}

async function runSetCurl(options, positionals, inlineCurlParts) {
  const { statePath, state } = await buildStateFromSetCurlInput({ options, positionals, inlineCurlParts });
  await saveState(statePath, state);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    statePath,
    sourceUrl: state.sourceUrl,
    headerNames: Object.keys(state.headers),
  }, null, 2)}\n`);
}

async function runGetTopic(options, positionals) {
  const topicId = options.topic ?? positionals[0];
  if (!topicId) {
    throw new Error('get-topic requires a topic id');
  }

  const statePath = getStatePath(options.state);
  const state = await loadState(statePath);
  const result = await fetchTopicPayload(state, topicId);
  if (!result.ok || !result.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  process.stdout.write(`${JSON.stringify(normalizeTopic(result.json), null, 2)}\n`);
}

async function runGetComments(options, positionals) {
  const topicId = options.topic ?? positionals[0];
  if (!topicId) {
    throw new Error('get-comments requires a topic id');
  }

  const statePath = getStatePath(options.state);
  const state = await loadState(statePath);
  const result = await fetchTopicPayload(state, topicId);
  if (!result.ok || !result.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  process.stdout.write(`${JSON.stringify(normalizeComments(result.json, options), null, 2)}\n`);
}

async function main() {
  const { command, options, positionals, inlineCurlParts } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === 'help') {
    printUsage();
    return;
  }

  if (command === 'set-curl') {
    await runSetCurl(options, positionals, inlineCurlParts);
    return;
  }

  if (command === 'get-topic') {
    await runGetTopic(options, positionals);
    return;
  }

  if (command === 'get-comments') {
    await runGetComments(options, positionals);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
