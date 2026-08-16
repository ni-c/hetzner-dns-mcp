# What is hetzner-dns-mcp?

hetzner-dns-mcp is a [Model Context Protocol](https://modelcontextprotocol.io)
server that puts the DNS half of the [Hetzner Cloud API](https://docs.hetzner.cloud/reference/cloud#zones)
in reach of an MCP client. It speaks JSON-RPC over stdio, exposes 22 tools, and
holds no state beyond the confirmation tokens it hands out.

With it connected, an assistant can answer "which zones do I have and when were
they last changed?", "what does `www.example.com` resolve to?", or "add the
verification TXT record this provider is asking for" — and can carry out the
change, once you have confirmed it.

::: warning The API this talks to
This server targets the DNS endpoints of the **Hetzner Cloud API**
(`api.hetzner.cloud`). The old DNS Console API (`dns.hetzner.com`) was shut down
in May 2026, and tokens created there do not work here. If calls come back 401
with a token you are sure is valid, that is almost always the reason — see the
[FAQ](/guide/faq).
:::

## What it can do

| Area                     | Tools                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Zones**                | list, get, create, update labels, delete, export/import zone files, change default TTL, protection, primaries      |
| **RRSets** (record sets) | list, get, create, update labels, delete, replace all records, add records, remove records, change TTL, protection |
| **Actions**              | list and get the asynchronous operations Hetzner queues behind imports and other slow changes                      |

The full list, with arguments, is in the [tool reference](/reference/tools).

## What it deliberately does not do

- **It does not decide on your behalf.** Every irreversible tool refuses its
  first call and returns a token; the second call has to repeat the identical
  arguments. See [Security](/guide/security).
- **It does not treat the API as authoritative prose.** Record values, comments,
  labels and zone files are written by whoever controls the zone, so everything
  coming back is marked as untrusted data and never quoted in a confirmation.
- **It does not manage anything but DNS.** The token is a Hetzner Cloud token
  with project-wide reach, but this server only ever calls `/v1/zones` paths.
  Give it a project that holds your zones and nothing else.

## Design in one paragraph

Arguments go through zod schemas that reject anything which could escape a URL
path — no slashes, no bare dot segments — before a request is built. Requests
carry a timeout and refuse to follow redirects, so the `Authorization` header
cannot be replayed at a third party. Destructive tools consult a confirmation
store keyed by the target and, where a payload matters, by a hash of it.
Responses pass a sanitizer that redacts secret-looking keys, truncates oversized
values, and wraps the whole thing in an `<untrusted-data>` envelope. The
credentials are deleted from the environment as soon as they have been read.

Next: [Getting started](/guide/getting-started).
