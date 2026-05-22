# ACP Protocol Notes

## Sources

- https://agentclientprotocol.com/get-started/
- https://agentclientprotocol.com/protocol/initialization
- https://agentclientprotocol.com/protocol/session-setup
- https://agentclientprotocol.com/protocol/prompt-turn
- npm package metadata for `@agentclientprotocol/sdk@0.22.1`
- npm package metadata for `@agentclientprotocol/claude-agent-acp@0.37.0`
- npm package metadata for `@agentclientprotocol/codex-acp@0.0.44`

## Protocol Shape

ACP is JSON-RPC 2.0 over newline-delimited JSON on stdio for local subprocess agents.
The minimal client lifecycle is:

1. `initialize`
   - Request: `{ protocolVersion: 1, clientInfo, clientCapabilities }`
   - Response: `{ protocolVersion, agentCapabilities, agentInfo }`
2. `session/new`
   - Request: `{ cwd, mcpServers: [], additionalDirectories? }`
   - Response: `{ sessionId, ... }`
3. `session/prompt`
   - Request: `{ sessionId, prompt: [{ type: "text", text }] }`
   - Response: `{ stopReason }`

Agents stream progress through client-facing `session/update` notifications:

- `agent_message_chunk`
- `agent_thought_chunk`
- `user_message_chunk`
- `tool_call`
- `tool_call_update`
- `plan`
- `usage_update`

Agents may also send client requests:

- `session/request_permission`
- `fs/read_text_file`
- `fs/write_text_file`
- terminal and MCP methods when advertised

For this runner MVP, advertise text file read/write and implement permission requests by choosing a reject option when present. Do not advertise terminal/MCP support yet, because the current platform contract keeps shell execution and approvals outside the agent backend.

## Official ACP Agents

- Claude: `@agentclientprotocol/claude-agent-acp` exposes `claude-agent-acp`.
- Codex: `@agentclientprotocol/codex-acp` exposes `codex-acp`.

Runtime command resolution must be configurable so local installs and wrapper paths can be used without changing code.

## Repository Impact

Current runner backend classes directly spawn:

- `claude --print --output-format stream-json ...`
- `codex exec --json ...`

The ACP integration should move the primary execution path to a shared stdio JSON-RPC client and keep backend-specific classes responsible for prompt construction, artifact checks, diff capture, and event labeling.
