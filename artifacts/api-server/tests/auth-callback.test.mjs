import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const buildOptions = {
  entryPoints: ["../kimeu-sme-app/src/auth/auth-callback.ts"],
  absWorkingDir: new URL("..", import.meta.url).pathname,
  bundle: true, platform: "node", format: "esm", write: false,
  plugins: [{ name: "no-auth-network", setup(builder) {
    builder.onResolve({ filter: /^\.\/supabase-client$/ }, () => ({ path: "client", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: "export function supabaseIdentity(){throw new Error('No network permitted')}",
    }));
  } }],
};
const result = await build(buildOptions);
const { preparePasswordCallback, passwordCallbackOrigin } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const developmentResult = await build({
  ...buildOptions, define: { "import.meta.env": JSON.stringify({ DEV: true }) },
});
const { preparePasswordCallback: prepareDevelopmentCallback } = await import(
  `data:text/javascript;base64,${Buffer.from(developmentResult.outputFiles[0].text).toString("base64")}`
);

test("only development accepts its own secure preview origin; production remains canonical", () => {
  const preview = "https://controlled-test.replit.dev";
  const canonical = "https://kimeu-sme-app.replit.app";
  assert.equal(passwordCallbackOrigin(true, preview), preview);
  assert.equal(passwordCallbackOrigin(false, preview), canonical);
  for (const origin of ["http://controlled-test.replit.dev", "https://controlled-test.replit.dev:8080",
    "https://controlled-test.replit.dev.attacker.test", "https://attacker.test",
    `${preview}/auth/recovery`, "invalid"]) {
    assert.equal(passwordCallbackOrigin(true, origin), canonical);
  }
});

function fixture(options = {}) {
  const events = [];
  const user = { id: "verified-user" };
  const session = { access_token: "never-log" };
  const result = options.invalid ? { data: { user: null, session: null }, error: {} }
    : { data: { user, session }, error: null };
  return {
    events,
    dependencies: {
      clearUrl: () => events.push("clear-url"),
      clearUserState: () => events.push("clear-user-state"),
      client: () => ({ auth: {
        verifyOtp: async input => { events.push(["verify", input.type]); return result; },
        exchangeCodeForSession: async () => { events.push("exchange"); return result; },
        getUser: async () => ({ data: { user: { id: options.switched ? "someone-else" : user.id } }, error: null }),
        updateUser: async input => {
          assert.ok(input.password);
          events.push("update-password");
          return { error: options.updateError ? {} : null };
        },
      } }),
    },
  };
}

test("development callback exchanges only a link on this browser's exact preview origin", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://controlled-test.replit.dev" } };
  try {
    const f = fixture();
    const finish = await prepareDevelopmentCallback(
      "https://controlled-test.replit.dev/auth/recovery?token_hash=opaque&type=recovery", f.dependencies,
    );
    await finish("test-only-password");
    assert.ok(f.events.includes("update-password"));
    const other = fixture();
    await assert.rejects(prepareDevelopmentCallback(
      "https://other-test.replit.dev/auth/recovery?code=opaque", other.dependencies,
    ), /invalid/);
    assert.deepEqual(other.events, ["clear-url", "clear-user-state"]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

for (const [path, type] of [["accept", "invite"], ["recovery", "recovery"]]) {
  test(`${type} callback clears sensitive URL, exchanges token, and updates password once`, async () => {
    const f = fixture();
    const finish = await preparePasswordCallback(
      `https://kimeu-sme-app.replit.app/auth/${path}?token_hash=opaque&type=${type}`, f.dependencies,
    );
    assert.deepEqual(f.events, ["clear-url", "clear-user-state", ["verify", type]]);
    await finish("test-only-password");
    await assert.rejects(finish("test-only-password"), /already been used/);
    assert.equal(f.events.filter(e => e === "update-password").length, 1);
  });
}
test("PKCE callback exchanges code through the provider", async () => {
  const f = fixture();
  await preparePasswordCallback("https://kimeu-sme-app.replit.app/auth/recovery?code=opaque", f.dependencies);
  assert.ok(f.events.includes("exchange"));
});
for (const suffix of [
  "/auth/recovery?token_hash=opaque&type=invite",
  "/auth/accept?token_hash=opaque&type=recovery",
  "/auth/recovery?code=opaque&type=invite",
  "/auth/recovery?code=opaque&token_hash=opaque",
  "/auth/recovery?code=a&code=b",
  "/auth/recovery#access_token=opaque",
  "/unapproved?code=opaque",
  "/auth/accept",
]) {
  test(`invalid callback fails before provider access: ${suffix}`, async () => {
    const f = fixture();
    await assert.rejects(preparePasswordCallback(`https://kimeu-sme-app.replit.app${suffix}`, f.dependencies));
    assert.deepEqual(f.events, ["clear-url", "clear-user-state"]);
  });
}
test("foreign callback origin is rejected", async () => {
  const f = fixture();
  await assert.rejects(preparePasswordCallback("https://attacker.test/auth/recovery?code=opaque", f.dependencies));
  assert.deepEqual(f.events, ["clear-url", "clear-user-state"]);
});
test("expired link never permits a password update", async () => {
  const f = fixture({ invalid: true });
  await assert.rejects(preparePasswordCallback(
    "https://kimeu-sme-app.replit.app/auth/recovery?token_hash=opaque&type=recovery", f.dependencies,
  ), /expired or is invalid/);
  assert.ok(!f.events.includes("update-password"));
});
test("changed login cannot use another session's password callback", async () => {
  const f = fixture({ switched: true });
  const finish = await preparePasswordCallback("https://kimeu-sme-app.replit.app/auth/recovery?code=opaque", f.dependencies);
  await assert.rejects(finish("test-only-password"), /sign-in changed/);
  assert.ok(!f.events.includes("update-password"));
});
test("provider password-policy rejection remains explicit", async () => {
  const f = fixture({ updateError: true });
  const finish = await preparePasswordCallback("https://kimeu-sme-app.replit.app/auth/recovery?code=opaque", f.dependencies);
  await assert.rejects(finish("test-only-password"), /password could not be saved/);
});
