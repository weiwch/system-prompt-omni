# system-prompt-omni

Display the full [pi coding agent](https://pi.dev) system prompt — with all injected tools,
guidelines, context files, and skills — in a scrollable full-screen overlay. The extension can
also export safe `SYSTEM.md` and `APPEND_SYSTEM.md` source files globally or for the current
project. System-prompt and tool history is now recorded natively by pi.

## Update

### v0.4.0 — Proudly retiring the custom recorder

**Mission accomplished! Since [pi v0.86.0](https://github.com/earendil-works/pi/releases/tag/v0.86.0),
pi itself provides the system-prompt and tool-history recording that this plugin originally
added. We're proud to retire our custom recorder and let pi handle session history.**

Native support arrived in [pi PR #9548](https://github.com/earendil-works/pi/pull/9548). Pi writes
system messages with prompt `sections` and `toolsAdded` / `toolsRemoved` directly into session
JSONL, preserving changes across resume and branch navigation.

This release removes the `before_provider_request` recorder, its helpers and tests, and stops
writing `pi-system-prompt` custom entries. The full-screen viewer, clipboard copying,
and prompt-file exports remain available. `SYSTEM.md` export also understands pi's structured
prompt layout, including `<cwd>` and dynamically injected sections.

**Compatibility:** v0.4.0 requires pi **v0.86.0 or later**. The old recorder remains in plugin
v0.3.2 for users who still need it. Existing `pi-system-prompt` entries are left in session
history; this update does not rewrite or delete them.

Native history records pi's structured prompt sections and tool declarations. It is not an
exact copy of the final provider request: this plugin no longer captures provider-specific
`serializedTools`, `providerSystemInstructions`, or request-only prompt rewrites.

## Usage

```text
/system-prompt
/system-prompt export
/system-prompt export system global
/system-prompt export system project
/system-prompt export append global
/system-prompt export append project
```

Inside the prompt viewer:

| Key | Action |
|-----|--------|
| `↑↓` / `j` `k` | Scroll line |
| `PgUp` / `PgDn` | Scroll page |
| `Home` / `End` | Jump to top/bottom |
| `c` | Copy full prompt and tool definitions to clipboard |
| `e` | Open the export wizard |
| `Esc` / `q` | Close |

The export wizard writes to one of these locations:

| Scope | `SYSTEM.md` | `APPEND_SYSTEM.md` |
|-------|-------------|--------------------|
| Global | `$PI_CODING_AGENT_DIR/SYSTEM.md` or `~/.pi/agent/SYSTEM.md` | `$PI_CODING_AGENT_DIR/APPEND_SYSTEM.md` or `~/.pi/agent/APPEND_SYSTEM.md` |
| Project | `<cwd>/.pi/SYSTEM.md` | `<cwd>/.pi/APPEND_SYSTEM.md` |

`SYSTEM.md` export is intentionally safe: if a custom prompt is already configured, its source
text is exported. Otherwise, the extension removes dynamically injected append text, project
context, skills, current working directory, and custom sections from the assembled prompt before
writing the default prefix, including its tools, rules, and documentation sections. Pi will
inject the dynamic sections again when it loads the exported file. If the expected layout cannot
be verified, the export stops instead of copying dynamic context into `SYSTEM.md`.

`APPEND_SYSTEM.md` export writes the currently configured append text. If none is configured,
the wizard can create an empty starter file. Existing files are never overwritten without
confirmation. Run `/reload` after exporting to load the new file.

## Native prompt history

Pi records prompt and tool history automatically; no recorder extension or special load order
is needed. The first model request stores the prompt sections and tool declarations in a normal
session message. A simplified entry looks like this:

```json
{
  "type": "message",
  "message": {
    "role": "system",
    "content": "",
    "sections": {
      "preamble": "You are a coding assistant...",
      "cwd": "<cwd>\n/project\n</cwd>"
    },
    "toolsAdded": [
      {
        "name": "read",
        "description": "Read files",
        "parameters": {
          "type": "object",
          "properties": { "path": { "type": "string" } },
          "required": ["path"]
        }
      }
    ]
  }
}
```

Later entries contain only changes: `sections` patches the named sections (`null` removes a
section), while `toolsAdded` and `toolsRemoved` update the tool declarations. To reconstruct the
current state, replay these changes along the active session branch rather than treating every
system message as a complete snapshot. Pi also carries a system-message checkpoint through
compaction.

See pi's [session format documentation](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/session-format.md#sessionmessageentry)
for the native schema. Consumers of the old `pi-system-prompt` custom entries should migrate to
this format; native history does not expose the old provider-specific snapshot fields.

## Install

```bash
pi install git:github.com/weiwch/system-prompt-omni
```

For local development:

```bash
pi install /path/to/system-prompt-omni
```

## Development

```bash
npm test
```

## Release

Keep the version in `package.json` and the Git tag in sync, then push the tag:

```bash
git tag v0.4.0
git push origin v0.4.0
```

The release workflow tests and publishes the package to npm before creating the matching GitHub
Release. Prerelease versions (for example, `v0.4.0-beta.1`) use npm's `next` tag and create a
GitHub prerelease. The workflow can also be run manually with an existing tag to safely repair a
partial release.

Publishing uses npm Trusted Publishing (OIDC), so the npm package must trust the GitHub repository
`weiwch/system-prompt-omni` and workflow filename `publish.yml`, with direct publishing allowed.
No long-lived npm token is required.

## License

Apache-2.0. See [LICENSE](LICENSE), which also contains the upstream attribution and a summary
of this fork's modifications.

## Upstream and acknowledgements

This project is a modified fork of
[jandrikus/pi-system-prompt](https://github.com/jandrikus/pi-system-prompt). Many thanks to
Alex (`jandrikus`) and the upstream contributors for the original system-prompt viewer. The
upstream work and this fork are distributed under the Apache License 2.0; the original license
and attribution are retained.
