# Asking a person

Ten of the 22 tools can decide who answers for a name, and DNS has no undo.
Those ten **ask a person first**.

Not a `confirm: true` argument the model can set. Not a token the model reads out
of its own previous result. A dialog, raised through [MCP
elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation),
that goes to the client and is shown to whoever is sitting there.

The specification says a client _should_ keep a human in the loop:

> there **SHOULD** always be a human in the loop with the ability to deny tool
> invocations

This server does not rely on that. It raises the question itself, and until an
answer comes back, nothing happens.

## What asks, and when

| Tool                         | When it asks                           |
| ---------------------------- | -------------------------------------- |
| `delete_zone`                | always                                 |
| `delete_rrset`               | always                                 |
| `import_zonefile`            | always, bound to the exact zone file   |
| `set_records`                | always, bound to the exact record list |
| `remove_records`             | always, bound to the exact record list |
| `change_primary_nameservers` | always, bound to the exact server list |
| `change_zone_protection`     | only when it **removes** protection    |
| `change_rrset_protection`    | only when it **removes** protection    |
| `create_rrset`               | when the record decides who answers    |
| `add_records`                | when the record decides who answers    |
| everything else              | never                                  |

Protection is the asymmetric case. Switching it _on_ costs nothing and is asked
about by nobody; switching it off is the step that makes the next delete possible,
and that is where the question belongs.

`update_rrset` is deliberately not on the list, and its own annotation used to say
it should be — the comment claimed it replaced records “exactly like
`set_records`”. It does not: it replaces an RRSet's **labels**, which are
organisational metadata. Nothing goes off the internet, so nothing is asked. It
stays marked destructive, because Hetzner keeps no history of labels either.

## Why adding is not automatically safe

The first eight entries are about loss. That is the right question for a file and
only half of it for a zone: the dangerous act in DNS is **making** a claim, not
withdrawing one, and none of the following removes anything.

- an `MX` at preference `0` beside the real one wins all mail — senders try
  ascending preference (RFC 5321 §5.1), and the existing record stays exactly
  where it was
- an `NS` on a subname creates a zone cut, and the parent starts issuing
  referrals for everything beneath it
- a `CAA` changes which certificate authority may issue at all
- `CNAME`, `DS`, `TLSA`, `SVCB` and `SRV` each redirect or re-key a name

So `create_rrset` and `add_records` ask when the type is one of those, when the
name is the apex `@` — where SPF, DMARC and the zone's own `NS` set live — or
when it contains `*`, which answers every name that does not exist yet.
Everything else, `www/A` included, goes through without a dialog.

### The deliberate exception

`_acme-challenge` `TXT` records are **not** gated, and that is a decision rather
than an oversight. Adding one is how DNS-01 renewal works, its entire purpose is
to run unattended, and a dialog on every certificate renewal is a cost with no
matching benefit — the confirmation cannot tell a real ACME client from a forged
token, because from here the two look identical.

What defends that name is `CAA`, which is gated now, plus Certificate
Transparency monitoring: a certificate issued behind your back shows up in the
CT logs within minutes. If you rely on this server for DNS-01, watch them.

## What the dialog contains

Zone names, record-set names, counts — and **the values this call is about to
write**, on their own lines under "supplied by the caller, not by this server".

That distinction is the point, and it used to be drawn one step too broadly.
Values that come _back from the API_ stay out: they are written by whoever
controls the zone, which for a zone you have just taken over is not necessarily
you, and the prompt is read by a model at the exact moment it is deciding.
Values that go _into_ the call are the opposite — they are the thing being
decided about, and without them the dialog is byte-identical whether the record
points where you meant or somewhere else. "Replace the records of `www/A` — it
currently holds 1 record" is true either way.

A `tsig_key` is never printed. The schema calls it a secret, and a dialog is not
the place for one.

```
This will delete RRSet "www/A" of zone "example.com".

It currently holds 2 record(s), TTL 300, and deleting is irreversible. Use
get_rrset to review the contents.
```

The approval is bound to its target, so one obtained for a call cannot be
replayed against another. For a _set_ of targets the binding is a fingerprint of
the exact list: an approval for `["a"]` does not execute `["a", "b"]`.

## Clients that cannot show a dialog

Not every MCP client implements elicitation, and a stateless gateway may not be
able to speak for the one it is currently serving. Rather than refuse to work —
which pushes people towards switching the guard off entirely — the tool falls
back to a **two-call token**: the first call returns a random string, the second
has to quote it back.

Be clear about what that proves, because this server is:

> the token proves the call was made twice with the same arguments, and nothing
> more.

A model can read the token out of the first result and call again in the same
turn without anybody seeing it. It catches a widened target set; it does not
catch a model that was talked into the whole thing. The fallback text says so
rather than implying somebody approved.

## Switching the dialog off

```sh
ELICITATION=false
```

Default is `true`. `false` does **not** remove the guard — it takes the fallback
path above, which means the token. There is no setting in which a guarded call
goes unannounced.

Use it where a dialog is the wrong shape rather than an unwanted one: a scheduled
job, a test harness, a client whose dialog interrupts something else.

::: warning It is deliberately not prefixed
`ELICITATION` has no `HETZNER_` in front of it, so one
`export ELICITATION=false` — or one `-e ELICITATION=false` in a compose file —
reaches **every** MCP server in that environment, not just this one. That is the
point of it and also its risk.

Two things make it visible rather than silent:

- a server started with it off prints one line at startup, in the log of every
  server it actually reached:

  ```
  hetzner-dns-mcp: ELICITATION=false — guarded tools fall back to the two-call token
  ```

- the fallback text names the server that did not ask, instead of blaming a
  client that was working fine.
  :::

Anything other than `true` or `false` — `1`, `off`, `yes` — **stops the server**
with exit code 1 and a message naming both valid values. This is the only
variable in this family that defaults to _on_: a typo that fell back to the
default would leave the dialog running while the operator believed it was off,
and there would be nothing to tell them.

## Annotations are the other half, and they are only a hint

Every tool of this server declares all four MCP tool annotations —
`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — so a
client can tell before it calls what a call would do. See
[Tools](/reference/tools).

They are advice, and the specification says so:

> clients **MUST** consider tool annotations to be untrusted unless they come
> from trusted servers

An annotation is something a client may ignore. The dialog is not: it is enforced
here, on the server side, and no answer means no change. The two are different
claims — the annotation says what a call _does_, the dialog decides whether it
_happens_ — which is why a tool can be marked destructive without being guarded.
`update_zone` and `change_rrset_ttl` are exactly that case: they replace a setting
with no history, which is destructive, and they are not asked about.

## Behind a gateway

Both protocol revisions are handled from one code path. On `2025-11-25` the
question is pushed to the client; on `2026-07-28` there is no server→client
channel at all, so the call returns `input_required`, ends, and the client
retries carrying the answer.

That answer arrives as ordinary request content, which the SDK does not
validate — so the state that ties an answer to its question is sealed (HMAC). A
reply whose seal does not open, or opens onto a different target, counts as **no
answer** and produces a fresh question rather than an error. The likeliest cause
is not an attack: it is a gateway that put the server to sleep while the person
was reading.

If you run this behind [mcp-hub](https://github.com/ni-c/mcp-hub), the hub passes
elicitation through in both directions; see its
[elicitation guide](https://ni-c.github.io/mcp-hub/guide/elicitation).
