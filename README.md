# system-prompt-omni

Display the full [pi coding agent](https://pi.dev) system prompt — with all injected tools,
guidelines, context files, and skills — in a scrollable full-screen overlay. The extension can
also export safe `SYSTEM.md` and `APPEND_SYSTEM.md` source files globally or for the current
project, and records each changed effective prompt in the current session.

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
context, skills, and current working directory from the assembled prompt before writing the
static default prefix. Pi will inject those dynamic sections again when it loads the exported
file.

`APPEND_SYSTEM.md` export writes the currently configured append text. If none is configured,
the wizard can create an empty starter file. Existing files are never overwritten without
confirmation. Run `/reload` after exporting to load the new file.

## Prompt recording

Before each provider request, the package compares the SHA-256 hashes of the effective system
prompt and serialized active tool definitions with the latest snapshot on the active session
branch. When either changes, a durable custom session entry with type `pi-system-prompt` records:

- the full effective system prompt, its hash, and UTF-8 byte length;
- provider, model, API, and thinking-level metadata;
- `serializedTools`, the tool-definition value copied from Pi's final provider payload and
  encoded as a compact JSON string; and
- provider-level system/developer instructions extracted from the serialized request.

No second tool representation is stored. Tool definitions are not rebuilt or sorted, so array
order and provider-specific structure stay identical to the `before_provider_request` payload.
For OpenAI Chat Completions, for example, the value has the same shape as
`current_harness_tools.json`:

```json
{
  "serializedTools": "[{\"type\":\"function\",\"function\":{\"name\":\"read\",\"description\":\"Read files\",\"parameters\":{\"type\":\"object\"}}}]"
}
```

The exact representation follows the active API. OpenAI Responses, Anthropic, Google, Bedrock,
and `pi-messages` therefore retain their own transmitted tool schema rather than being converted
to the Chat Completions shape. Load this package after extensions that rewrite provider requests
so it observes their final tool order and definitions.

The recorder never stores the complete provider payload, never adds its custom entries to the
LLM context, and returns the payload unchanged. Loading it last also ensures rewritten provider
instructions are included in the snapshot.

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

## License

Apache-2.0. See [LICENSE](LICENSE), which also contains the upstream attribution and a summary
of this fork's modifications.

## Upstream and acknowledgements

This project is a modified fork of
[jandrikus/pi-system-prompt](https://github.com/jandrikus/pi-system-prompt). Many thanks to
Alex (`jandrikus`) and the upstream contributors for the original system-prompt viewer. The
upstream work and this fork are distributed under the Apache License 2.0; the original license
and attribution are retained.
