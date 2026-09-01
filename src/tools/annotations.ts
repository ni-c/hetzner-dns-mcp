/**
 * The annotation block every reading tool of this server carries, and the rule
 * the writing ones follow.
 *
 * Written out rather than left to the defaults, because the defaults are not
 * neutral: the specification says `destructiveHint` and `openWorldHint` both
 * default to **true**, so an omitted field is the *stronger* claim. A tool that
 * says nothing is a destructive tool in an open world.
 *
 * The line this family draws for `destructiveHint`, since the specification
 * only offers "destructive" against "additive only":
 *
 *   **Content that a person wrote, replaced with no way back — destructive.**
 *   **A setting, a state or a marker, changed — not destructive.**
 *
 * DNS makes that line unusually easy to draw and unusually important to get
 * right. An RRSet's records *are* the content; replacing them is what takes a
 * name off the internet. A TTL is a setting. Protection is a state — though
 * removing it is guarded anyway, because it is the safety rail in front of
 * everything else here.
 *
 * `openWorldHint: false`: this server talks to the one Hetzner account its
 * token belongs to. That the records it writes are then served to the whole
 * internet is a property of DNS, not of the tool call.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
