import test from "node:test";
import assert from "node:assert/strict";
import { rootCertificates } from "node:tls";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/lib/kimeu/db/connection-options.ts"],
  absWorkingDir: new URL("..", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { truthDatabaseConnectionOptions: settings } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const url = "postgres://test_user:fake_password@database.example.test:6543/postgres";

test("verifies certificates by default and bounds connection establishment", () => {
  const result = settings(url);
  assert.equal(result.options.ssl.rejectUnauthorized, true);
  assert.equal(result.options.prepare, false);
  assert.equal(result.options.max, 1);
  assert.equal(result.options.connect_timeout, 10);
  assert.equal(result.options.ssl.ca, undefined);
});

test("connection-string sslmode cannot disable verification", () => {
  for (const mode of ["disable", "require", "no-verify", "verify-full"]) {
    const result = settings(`${url}?sslmode=${mode}&application_name=kimeu_sme`);
    const parsed = new URL(result.connectionString);
    assert.equal(parsed.searchParams.has("sslmode"), false);
    assert.equal(parsed.searchParams.get("application_name"), "kimeu_sme");
    assert.equal(result.options.ssl.rejectUnauthorized, true);
  }
});

test("accepts a public CA certificate and escaped PEM newlines", () => {
  const ca = rootCertificates[0].trim();
  assert.equal(settings(url, ca).options.ssl.ca, ca);
  assert.equal(settings(url, ca.replace(/\n/g, "\\n")).options.ssl.ca, ca);
});

test("rejects malformed CA material and private keys", () => {
  for (const ca of ["not a certificate", "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----", `${rootCertificates[0]}\nprivate material`]) {
    assert.throws(() => settings(url, ca), /public PEM CA certificates only/);
  }
});

test("invalid URL errors never echo credentials", () => {
  assert.throws(
    () => settings("postgres://user:do_not_echo_this@["),
    error => !error.message.includes("do_not_echo_this") && /valid PostgreSQL/.test(error.message),
  );
});

test("refuses a non-PostgreSQL protocol", () => {
  assert.throws(() => settings("https://example.test"), /PostgreSQL protocol/);
});
