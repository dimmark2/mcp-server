import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { Pool } from "pg";
const PGHOST = process.env.PGHOST ?? "centerbeam.proxy.rlwy.net";
const PGPORT = Number(process.env.PGPORT ?? "13403");
const PGUSER = process.env.PGUSER ?? "postgres";
const PGPASSWORD = process.env.PGPASSWORD ?? "qDJqEEbhMrQThzXAKRgtIFzFVKsHSaio";
const PGDATABASE = process.env.PGDATABASE ?? "postgres";
const pool = new Pool({
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE,
    max: 5,
});
const mcpServer = new McpServer({ name: "postgres-schema-sql-http", version: "0.1.0" });
mcpServer.registerTool("list_tables", {
    description: "List tables in the mcp_demo schema (or specified schema).",
    inputSchema: z.object({
        schema: z
            .string()
            .describe("Postgres schema name. Defaults to mcp_demo.")
            .optional(),
    }),
}, async (args) => {
    const schema = args.schema ?? "mcp_demo";
    const { rows } = await pool.query(`SELECT table_schema, table_name
       FROM information_schema.tables
       WHERE table_schema = $1
       ORDER BY table_name`, [schema]);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(rows, null, 2),
            },
        ],
    };
});
mcpServer.registerTool("describe_table", {
    description: "Describe columns for a given table (name and type).",
    inputSchema: z.object({
        table: z
            .string()
            .describe("Table name to describe (without schema or with schema.table)."),
        schema: z
            .string()
            .describe("Optional schema if table name is not qualified. Defaults to mcp_demo.")
            .optional(),
    }),
}, async (args) => {
    const tableArg = args.table;
    const schemaArg = args.schema ?? "mcp_demo";
    let schema = schemaArg;
    let table = tableArg;
    if (tableArg.includes(".")) {
        const parts = tableArg.split(".", 2);
        const sch = parts[0];
        const tbl = parts[1];
        schema = sch ?? schema;
        table = tbl ?? table;
    }
    const { rows } = await pool.query(`SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`, [schema, table]);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ schema, table, columns: rows }, null, 2),
            },
        ],
    };
});
mcpServer.registerTool("sample_rows", {
    description: "Return a small sample of rows from a table.",
    inputSchema: z.object({
        table: z
            .string()
            .describe("Table name to sample (without schema or with schema.table)."),
        schema: z
            .string()
            .describe("Optional schema if table name is not qualified. Defaults to mcp_demo.")
            .optional(),
        limit: z
            .number()
            .describe("Maximum sample size (default 10, max 100).")
            .optional(),
    }),
}, async (args) => {
    const tableArg = args.table;
    const schemaArg = args.schema ?? "mcp_demo";
    let limit = args.limit ?? 10;
    if (!Number.isFinite(limit) || limit <= 0)
        limit = 10;
    if (limit > 100)
        limit = 100;
    let schema = schemaArg;
    let table = tableArg;
    if (tableArg.includes(".")) {
        const parts = tableArg.split(".", 2);
        const sch = parts[0];
        const tbl = parts[1];
        schema = sch ?? schema;
        table = tbl ?? table;
    }
    const queryText = `SELECT * FROM ${schema}.${table} LIMIT $1`;
    const { rows } = await pool.query(queryText, [limit]);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ schema, table, limit, rows }, null, 2),
            },
        ],
    };
});
mcpServer.registerTool("run_select", {
    description: "Execute a read-only SELECT query against Postgres. The query must start with SELECT and cannot modify data.",
    inputSchema: z.object({
        sql: z
            .string()
            .describe("The SELECT SQL query to run. Must begin with SELECT and should reference tables in mcp_demo."),
        max_rows: z
            .number()
            .describe("Maximum number of rows to return (default 100, max 500).")
            .optional(),
    }),
}, async (args) => {
    const sqlRaw = args.sql.trim();
    let maxRows = args.max_rows ?? 100;
    if (!Number.isFinite(maxRows) || maxRows <= 0)
        maxRows = 100;
    if (maxRows > 500)
        maxRows = 500;
    const normalized = sqlRaw
        .replace(/^\(*/g, "")
        .trim()
        .toUpperCase();
    if (!normalized.startsWith("SELECT")) {
        throw new Error("Only SELECT queries are allowed in run_select.");
    }
    if (sqlRaw.includes(";")) {
        throw new Error("Multiple statements are not allowed; omit the semicolon.");
    }
    const forbidden = [
        "INSERT",
        "UPDATE",
        "DELETE",
        "ALTER",
        "DROP",
        "TRUNCATE",
        "CREATE",
        "GRANT",
        "REVOKE",
    ];
    for (const kw of forbidden) {
        if (normalized.includes(kw)) {
            throw new Error(`Keyword ${kw} is not allowed in run_select.`);
        }
    }
    const wrapped = `SELECT * FROM (${sqlRaw}) AS sub LIMIT $1`;
    const { rows, fields } = await pool.query(wrapped, [maxRows]);
    const columns = fields.map((f) => f.name);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    sql: sqlRaw,
                    maxRows,
                    columns,
                    rows,
                }, null, 2),
            },
        ],
    };
});
async function main() {
    try {
        await pool.query("SELECT 1");
        // eslint-disable-next-line no-console
        console.error("HTTP MCP server: connected to Postgres at", `${PGHOST}:${PGPORT}/${PGDATABASE}`);
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error("HTTP MCP server: failed to connect to Postgres:", err);
    }
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
        enableJsonResponse: true,
    });
    await mcpServer.connect(transport);
    const port = Number(process.env.PORT ?? process.env.MCP_HTTP_PORT ?? "3333");
    const httpServer = createServer((req, res) => {
        const chunks = [];
        req.on("data", (chunk) => {
            chunks.push(chunk);
        });
        req.on("end", async () => {
            let parsedBody = undefined;
            if (chunks.length > 0) {
                const body = Buffer.concat(chunks).toString("utf8");
                if (body.trim().length > 0) {
                    try {
                        parsedBody = JSON.parse(body);
                    }
                    catch (err) {
                        res.statusCode = 400;
                        res.setHeader("content-type", "application/json");
                        res.end(JSON.stringify({ error: "Invalid JSON body", details: String(err) }));
                        return;
                    }
                }
            }
            try {
                await transport.handleRequest(req, res, parsedBody);
            }
            catch (err) {
                res.statusCode = 500;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ error: "Failed to handle MCP request", details: String(err) }));
            }
        });
    });
    httpServer.listen(port, () => {
        // eslint-disable-next-line no-console
        console.error(`HTTP MCP server listening on http://localhost:${port}/`);
    });
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("HTTP MCP server fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=httpServer.js.map