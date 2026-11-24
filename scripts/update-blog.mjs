// Rewrites the "Latest from the blog" section of README.md from the public
// posts API of the portfolio site (GET /api/posts). No dependencies.
//
//   SITE_URL=https://example.workers.dev node scripts/update-blog.mjs
//
// Safe by design: the list is only replaced after a successful, well-formed
// response, so a down site never wipes the existing section.

import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const START = '<!-- BLOG-POSTS:START -->'
const END = '<!-- BLOG-POSTS:END -->'
const MAX_POSTS = 5
const MAX_RESPONSE_CHARS = 1_500_000
const SLUG_RE = /^[a-z0-9-]{1,80}$/

/** Returns the site origin (no trailing slash). https only, except localhost for testing. */
export function parseSiteUrl(raw) {
  let url
  try {
    url = new URL(String(raw ?? '').trim())
  } catch {
    throw new Error('SITE_URL is not a valid URL')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('SITE_URL must start with https://')
  }
  if (url.username || url.password) throw new Error('SITE_URL must not contain credentials')
  return url.origin
}

/** Makes untrusted text safe to place inside a Markdown link label. */
export function escapeMarkdown(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/&/g, '&amp;')
    .replace(/[\\`*_{}[\]<>()#+\-.!|~]/g, '\\$&')
}

export function renderPosts(origin, posts) {
  const valid = (Array.isArray(posts) ? posts : [])
    .filter((p) => p && typeof p.title === 'string' && p.title.trim() && SLUG_RE.test(p.slug ?? ''))
    .slice(0, MAX_POSTS)

  if (valid.length === 0) {
    return `_Nothing published yet. Visit the [blog](${origin}/blog) soon._`
  }

  const lines = valid.map((p) => {
    const date = Number.isFinite(p.publishedAt) ? new Date(p.publishedAt).toISOString().slice(0, 10) : null
    return `- [${escapeMarkdown(p.title)}](${origin}/blog/${p.slug})${date ? ` · ${date}` : ''}`
  })
  lines.push('', `[Read all posts →](${origin}/blog)`)
  return lines.join('\n')
}

export function replaceSection(readme, content) {
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md must contain ${START} and ${END}, in that order`)
  }
  return `${readme.slice(0, start + START.length)}\n${content}\n${readme.slice(end)}`
}

async function fetchPosts(origin) {
  const res = await fetch(`${origin}/api/posts`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`The posts API answered HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_RESPONSE_CHARS) throw new Error('The posts API response is unexpectedly large')
  const data = JSON.parse(text)
  if (!data || !Array.isArray(data.posts)) throw new Error('The posts API response has no "posts" array')
  return data.posts
}

async function main() {
  const origin = parseSiteUrl(process.env.SITE_URL)
  const posts = await fetchPosts(origin)
  const readme = await readFile('README.md', 'utf8')
  const next = replaceSection(readme, renderPosts(origin, posts))
  if (next === readme) {
    console.log('README.md is already up to date.')
    return
  }
  await writeFile('README.md', next)
  console.log(`README.md updated with ${Math.min(posts.length, MAX_POSTS)} post(s).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`update-blog: ${err.message}`)
    process.exit(1)
  })
}
