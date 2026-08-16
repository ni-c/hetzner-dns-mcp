# vhs script for the demo GIF: writes docs/public/demo.gif
#
# Prerequisites — all reproducible, no credentials and no real zones:
#   * vhs installed (https://github.com/charmbracelet/vhs)
#   * npm run build                 (dist/index.js must exist)
#   * node docs/demo-mock.mjs &     (fabricated API on http://localhost:8787/v1)
#   * run from the repository root: vhs docs/demo.tape
#
# Rules learned the hard way:
#   * inside Hide blocks use vhs's own `Sleep`, never the shell's — a shell
#     sleep blocks while vhs keeps typing, and the tape ends before any output
#   * `Hide` only stops frames being captured; whatever was typed is still in
#     the terminal buffer and reappears on `Show`. Anything that must not be
#     seen has to happen before the first `Show`, not between two of them.
#   * the demo runs ONE session on purpose. Confirmation tokens live in the
#     server process, so a CLI that spawns a fresh server per call can never
#     complete the two-step flow — the pacing lives in docs/demo-client.mjs.

Output docs/public/demo.gif

Set FontSize 16
Set Width 1180
Set Height 660
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms
Set Shell bash

Hide
Type `clear`
Enter
Sleep 500ms
Show

Type "# one MCP session against hetzner-dns-mcp"
Enter
Sleep 1200ms
Type "node docs/demo-client.mjs"
Enter
Sleep 16s
