# linuxdo-cli

Minimal local-bin CLI for reusing a Linux.do browser `curl` request context and fetching LLM-oriented slim topic data.

## What it does

- imports a browser-exported `curl` request once with `set-curl`
- stores a tiny reusable request context on disk
- fetches slim topic output with `get-topic`
- fetches comment-only output with `get-comments`

Default topic output is intentionally slim:

- `topic`
- `engagement`
- `content`

Comment retrieval is separate so the main post body is not duplicated in LLM context.

## Requirements

- Node.js 18+

## Install from a local clone

```bash
npm install -g --prefix "$HOME/.local" .
```

Make sure `~/.local/bin` is on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Install directly from GitHub

```bash
npm install -g --prefix "$HOME/.local" git+https://github.com/luyanhexay/linuxdo-cli.git
```

## Usage

### 1. Import or refresh a browser curl context

```bash
linuxdo set-curl --from-file ./request.curl
```

You can also paste a full curl command directly:

```bash
linuxdo set-curl "curl 'https://linux.do/t/topic/1000000' -H 'cookie: ...' -H 'user-agent: ...'"
```

Or use header-only shorthand. In that form, everything before the first `-H` may be omitted **if** you also pass `--url` or already have a saved session whose `sourceUrl` can be reused:

```bash
linuxdo set-curl --url https://linux.do/t/topic/1000000 -H 'cookie: ...' -H 'user-agent: ...'
linuxdo set-curl -H 'cookie: refreshed' -H 'user-agent: Mozilla/5.0'
```

By default the request context is saved to:

```text
~/.config/linuxdo-cli/session.json
```

You can override that path with `--state`.

### 2. Fetch a slim topic

```bash
linuxdo get-topic 1000000
```

Example shape:

```json
{
  "topic": {
    "id": 1000000,
    "title": "...",
    "slug": "...",
    "created_at": "...",
    "last_posted_at": "...",
    "tags": ["..."],
    "author": {
      "id": 1,
      "username": "...",
      "name": "..."
    }
  },
  "engagement": {
    "posts_count": 146,
    "reply_count": 60,
    "views": 1842,
    "like_count": 284,
    "participant_count": 106
  },
  "content": "main post raw markdown"
}
```

### 3. Fetch comments only

```bash
linuxdo get-comments 1000000 --from 1 --limit 20
```

This returns a stronger slim shape and does **not** repeat the main post content.

List mode:

```bash
linuxdo get-comments 1000000 --from 1 --limit 20 --shape list
```

Tree mode:

```bash
linuxdo get-comments 1000000 --from 1 --limit 20 --shape tree
```

## Notes

- The CLI replays a browser-derived request context; it does not bypass Cloudflare on its own.
- If the context expires, import a fresh browser `curl` with `set-curl` again.
- Header-only `set-curl` shorthand reuses the previously saved `sourceUrl` unless you override it with `--url`.
- Topic fetches keep the same success output, but internally retry with Node `fetch`, system `curl`, and Python `urllib` before failing.
- When every transport fails, the error output includes an `attempts` array so you can see which path failed and why.
- Current comment retrieval slices the replies already present in the fetched topic JSON window; full cross-window expansion is not implemented yet.

## Repository layout

```text
bin/linuxdo.mjs         CLI entrypoint
mock/                   local mock fixtures for smoke testing
samples/                real sample payloads for output design
OVERVIEW.md             repository index
```
