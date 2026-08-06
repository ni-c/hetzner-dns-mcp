# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-06

### Added

- Initial release targeting the DNS endpoints of the Hetzner Cloud API
  (`api.hetzner.cloud/v1`, Bearer token authentication). The legacy DNS API
  (`dns.hetzner.com`) is not supported.
- Zone tools: `list_zones`, `get_zone`, `create_zone`, `update_zone`,
  `delete_zone` (guarded by a `confirm` parameter), `export_zonefile`,
  `import_zonefile` (guarded by a `confirm` parameter), `change_zone_ttl`,
  `change_zone_protection`, `change_primary_nameservers`.
- RRSet tools: `list_rrsets`, `get_rrset`, `create_rrset`, `update_rrset`,
  `delete_rrset` (guarded by a `confirm` parameter), `set_records`,
  `add_records`, `remove_records`, `change_rrset_ttl`,
  `change_rrset_protection`.
- Action tools: `list_zone_actions`, `get_zone_action`.
- Configuration via `HETZNER_API_TOKEN`, optional `HETZNER_API_BASE_URL`.
