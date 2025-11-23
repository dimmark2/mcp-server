import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
function buildEnv() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === "string") {
            env[key] = value;
        }
    }
    if (!env.PGHOST)
        env.PGHOST = "centerbeam.proxy.rlwy.net";
    if (!env.PGPORT)
        env.PGPORT = "13403";
    if (!env.PGUSER)
        env.PGUSER = "postgres";
    if (!env.PGDATABASE)
        env.PGDATABASE = "postgres";
    if (!env.PGPASSWORD)
        env.PGPASSWORD = "qDJqEEbhMrQThzXAKRgtIFzFVKsHSaio";
    return env;
}
async function main() {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: buildEnv(),
        stderr: "inherit",
    });
    const client = new Client({ name: "postgres-mcp-test-client", version: "0.1.0" }, {});
    await client.connect(transport);
    console.log("=== list_tables(df365) ===");
    const listTables = await client.callTool({
        name: "list_tables",
        arguments: { schema: "df365" },
    });
    console.log(JSON.stringify(listTables, null, 2));
    console.log("\n=== describe_table(clients) ===");
    const describeClients = await client.callTool({
        name: "describe_table",
        arguments: { table: "clients", schema: "df365" },
    });
    console.log(JSON.stringify(describeClients, null, 2));
    console.log("\n=== sample_rows(deals, limit=3) ===");
    const sampleDeals = await client.callTool({
        name: "sample_rows",
        arguments: { table: "deals", schema: "df365", limit: 3 },
    });
    console.log(JSON.stringify(sampleDeals, null, 2));
    console.log('\n=== run_select("SELECT c.name, d.deal_name, d.amount FROM df365.deals d JOIN df365.clients c ON c.client_id = d.client_id") ===');
    const runSelect = await client.callTool({
        name: "run_select",
        arguments: {
            sql: "SELECT c.name, d.deal_name, d.amount FROM df365.deals d JOIN df365.clients c ON c.client_id = d.client_id ORDER BY d.deal_id",
            max_rows: 10,
        },
    });
    console.log(JSON.stringify(runSelect, null, 2));
    await transport.close();
}
main().catch((err) => {
    console.error("Test client error:", err);
    process.exit(1);
});
//# sourceMappingURL=testClient.js.map