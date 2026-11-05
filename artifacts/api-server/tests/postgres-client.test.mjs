import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/lib/kimeu/db/client.ts"],
  absWorkingDir: new URL("..", import.meta.url).pathname,
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "isolated-client", setup(b) {
    b.onResolve({ filter: /^(postgres|\.\.\/sheets)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      contents: path === "postgres"
        ? "export default function postgres(url, options){return {options}}"
        : "export class KimeuError extends Error {}",
    }));
  } }],
});
const client = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("serial reads and exclusively reserved writes use separate bounded clients", () => {
  const previous = process.env.KIMEU_TRUTH_DATABASE_URL;
  process.env.KIMEU_TRUTH_DATABASE_URL = "postgres://fixture:fake@database.example.test:6543/postgres";
  try {
    const read = client.getSql(), write = client.getTransactionSql();
    assert.notEqual(read, write);
    assert.equal(client.getSql(), read);
    assert.equal(client.getTransactionSql(), write);
    assert.equal(read.options.max_pipeline, 0);
    assert.equal(write.options.max_pipeline, 1);
    for (const sql of [read, write]) {
      assert.equal(sql.options.max, 1);
      assert.equal(sql.options.prepare, false);
      assert.equal(sql.options.ssl.rejectUnauthorized, true);
    }
    const fake = {};
    client.setSql(fake);
    assert.equal(client.getSql(), fake);
    assert.equal(client.getTransactionSql(), fake);
  } finally {
    client.setSql(undefined);
    if (previous === undefined) delete process.env.KIMEU_TRUTH_DATABASE_URL;
    else process.env.KIMEU_TRUTH_DATABASE_URL = previous;
  }
});
