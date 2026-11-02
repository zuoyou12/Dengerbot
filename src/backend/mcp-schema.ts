// Shared by migration v20 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// The table is deliberately not keyed by a server id. This database holds the configuration of this
// machine's host; a remote server's list lives in that host's own database and is read over the
// wire. "Per server" is realised by routing, not by a column that would always read `local`.
//
// The arrays are JSON text rather than child tables: the app always reads a record whole, and the
// row order the user typed is meaningful. `CHECK(json_valid(...))` follows
// `projection_channel_routine_triggers.schedule_json`.
//
// The unique name is load-bearing, not cosmetic. All four providers key MCP servers by name, so two
// rows sharing one name would silently collapse into one server at spawn.
export const MCP_SERVERS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS projection_mcp_servers (
    mcp_server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    transport TEXT NOT NULL CHECK(transport IN ('stdio', 'http')),
    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
    command TEXT NOT NULL,
    args_json TEXT NOT NULL CHECK(json_valid(args_json)),
    env_json TEXT NOT NULL CHECK(json_valid(env_json)),
    env_passthrough_json TEXT NOT NULL CHECK(json_valid(env_passthrough_json)),
    working_directory TEXT NOT NULL,
    url TEXT NOT NULL,
    headers_json TEXT NOT NULL CHECK(json_valid(headers_json)),
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mcp_servers_order ON projection_mcp_servers(position, mcp_server_id);
  CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_name ON projection_mcp_servers(name);
`;

import type { DatabaseSync } from "node:sqlite";

export interface PresetMcpServerDefinition {
  readonly id: string;
  readonly name: string;
  readonly transport: "stdio" | "http";
  readonly enabled: boolean;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly key: string; readonly value: string }[];
  readonly envPassthrough: readonly string[];
  readonly workingDirectory: string;
  readonly url: string;
  readonly headers: readonly { readonly key: string; readonly value: string }[];
}

/**
 * Pre-configured MCP servers catalog:
 * - memory: stdio, npx -y @modelcontextprotocol/server-memory (enabled: 1)
 * - fetch: stdio, npx -y @modelcontextprotocol/server-fetch (enabled: 1)
 * - filesystem: stdio, npx -y @modelcontextprotocol/server-filesystem . (enabled: 0)
 * - volcengine: stdio, uvx mcp-server-volcengine, env ARK_API_KEY, VOLCENGINE_REGION=cn-beijing (enabled: 0)
 * - brave-search: stdio, npx -y @brave/brave-search-mcp-server, env BRAVE_API_KEY (enabled: 0)
 * - github: stdio, npx -y @modelcontextprotocol/server-github, env GITHUB_PERSONAL_ACCESS_TOKEN (enabled: 0)
 */
export const DEFAULT_PRESET_MCP_SERVERS: readonly PresetMcpServerDefinition[] = [
  {
    id: "preset_mcp_memory",
    name: "memory",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
  {
    id: "preset_mcp_fetch",
    name: "fetch",
    transport: "stdio",
    // Disabled: the fetch reference server is the Python one (`uvx mcp-server-fetch`); the npm
    // package this command named does not exist, so an enabled row failed on every agent launch.
    enabled: false,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
  {
    id: "preset_mcp_filesystem",
    name: "filesystem",
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
  {
    id: "preset_mcp_volcengine",
    name: "volcengine",
    transport: "stdio",
    enabled: false,
    command: "uvx",
    args: ["mcp-server-volcengine"],
    env: [
      { key: "ARK_API_KEY", value: "" },
      { key: "VOLCENGINE_REGION", value: "cn-beijing" },
    ],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
  {
    id: "preset_mcp_brave_search",
    name: "brave-search",
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server"],
    env: [{ key: "BRAVE_API_KEY", value: "" }],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
  {
    id: "preset_mcp_github",
    name: "github",
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", value: "" }],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
];

export function seedDefaultMcpServersIfEmpty(db: DatabaseSync, now = new Date().toISOString()): number {
  const countRow = db.prepare("SELECT COUNT(*) AS count FROM projection_mcp_servers").get() as
    | { count?: number }
    | undefined;
  const count = typeof countRow?.count === "number" ? countRow.count : 0;
  if (count > 0) return 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO projection_mcp_servers (
       mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
       working_directory, url, headers_json, position, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let inserted = 0;
  for (const [index, server] of DEFAULT_PRESET_MCP_SERVERS.entries()) {
    insert.run(
      server.id,
      server.name,
      server.transport,
      server.enabled ? 1 : 0,
      server.command,
      JSON.stringify(server.args),
      JSON.stringify(server.env),
      JSON.stringify(server.envPassthrough),
      server.workingDirectory,
      server.url,
      JSON.stringify(server.headers),
      index,
      now,
      now,
    );
    inserted++;
  }
  return inserted;
}

