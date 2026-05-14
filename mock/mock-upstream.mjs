#!/usr/bin/env node
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 40111);

const server = createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing URL' }));
    return;
  }

  if (req.url === '/latest.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ topic_list: { topics: [{ id: 111903 }, { id: 1871216 }] } }));
    return;
  }

  const topicMatch = req.url.match(/^\/t\/(\d+)\.json(?:\?include_raw=1)?$/);
  if (topicMatch) {
    const cookie = req.headers.cookie ?? '';
    const authorized = cookie.includes('bridge_token=ok');
    if (!authorized) {
      res.writeHead(403, {
        'content-type': 'text/html; charset=utf-8',
        'cf-mitigated': 'challenge',
      });
      res.end('<html><head><title>Just a moment...</title></head><body>challenge</body></html>');
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: Number(topicMatch[1]),
      title: `Mock topic ${topicMatch[1]}`,
      slug: 'mock-topic',
      created_at: '2026-01-01T00:00:00.000Z',
      last_posted_at: '2026-01-01T00:05:00.000Z',
      tags: [{ id: 1, name: 'mock-tag', slug: 'mock-tag' }],
      posts_count: 5,
      reply_count: 4,
      views: 42,
      like_count: 7,
      participant_count: 3,
      details: {
        created_by: {
          id: 101,
          username: 'mock-user',
          name: 'Mock User',
        },
      },
      post_stream: {
        posts: [
          {
            id: 1,
            post_number: 1,
            username: 'mock-user',
            name: 'Mock User',
            created_at: '2026-01-01T00:00:00.000Z',
            reply_to_post_number: null,
            raw: `raw content for ${topicMatch[1]}`,
            cooked: `<p>raw content for ${topicMatch[1]}</p>`
          },
          {
            id: 2,
            post_number: 2,
            username: 'alice',
            name: 'Alice',
            created_at: '2026-01-01T00:01:00.000Z',
            reply_to_post_number: null,
            raw: `reply 1 for ${topicMatch[1]}`,
          },
          {
            id: 3,
            post_number: 3,
            username: 'bob',
            name: 'Bob',
            created_at: '2026-01-01T00:02:00.000Z',
            reply_to_post_number: 2,
            raw: `reply 2 for ${topicMatch[1]}`,
          },
          {
            id: 4,
            post_number: 4,
            username: 'carol',
            name: 'Carol',
            created_at: '2026-01-01T00:03:00.000Z',
            reply_to_post_number: null,
            raw: `reply 3 for ${topicMatch[1]}`,
          },
          {
            id: 5,
            post_number: 5,
            username: 'dave',
            name: 'Dave',
            created_at: '2026-01-01T00:04:00.000Z',
            reply_to_post_number: 4,
            raw: `reply 4 for ${topicMatch[1]}`,
          }
        ]
      }
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock-upstream listening on http://127.0.0.1:${port}`);
});
