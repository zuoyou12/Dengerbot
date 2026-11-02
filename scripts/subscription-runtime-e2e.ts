// Real Bun host + isolated provider fixture. Never reads a user's account or calls a vendor.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SubscriptionModelBridge } from "../src/main/subscription-model-bridge";
import { SubscriptionPluginRuntime } from "../src/main/subscription-runtime";

const output = resolve(import.meta.dirname, "../.openbot-build/subscription-runtime-e2e");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "fixture-"));
const packageName = "@magpie-community/opencode-workbuddy-auth";
const packageDirectory = join(
  directory,
  "packages",
  "opencode-workbuddy-auth",
  "node_modules",
  "@magpie-community",
  "opencode-workbuddy-auth",
);
await mkdir(packageDirectory, { recursive: true });
await writeFile(
  join(packageDirectory, "package.json"),
  JSON.stringify({ name: packageName, version: "1.0.0", type: "module", main: "index.js" }),
);
await writeFile(
  join(packageDirectory, "index.js"),
  `
export const Fixture = async () => ({
  config(c) { c.provider.workbuddy={name:'WorkBuddy fixture',npm:'@ai-sdk/anthropic',api:'https://fixture.invalid',models:{'live-model':{name:'Live fixture model',limit:{context:32000,output:4000}},'openai-model':{name:'OpenAI fixture model',provider:{npm:'@ai-sdk/openai-compatible'}}}} },
  auth: {provider:'workbuddy',
    methods:[{type:'oauth',label:'Fixture device login',prompts:[{key:'region',type:'select',message:'Region',options:[{label:'China',value:'cn'}]}],authorize:async()=>({url:'https://fixture.invalid/login',method:'code',instructions:'Use fixture code',callback:async(code)=>code==='fixture-code'?{type:'success',refresh:'fixture-refresh-secret',access:'fixture-access-secret',expires:Date.now()+3600000}:{type:'failed'}})},{type:'api',label:'Fixture API key'},{type:'oauth',label:'Local CLI',authorize:async()=>({url:'',method:'code',instructions:'Complete local CLI login',callback:async()=>({type:'failed'})})}],
    options:[{key:'fixture-option',label:'Fixture option',default:false},{key:'other-option',label:'Other option',default:false}],
    loader:async()=>({apiKey:'fixture-access-secret',baseURL:'https://fixture.invalid',fetch:async(_url,init)=>{ if(String(init.body).includes('expire-fixture')) throw Object.assign(new Error('Fixture expired'),{signIn:'expired'}); if(init.headers.get('x-api-key')!=='fixture-access-secret' && init.headers.get('authorization')!=='Bearer fixture-access-secret') throw Error('missing native auth'); return new Response('x'.repeat(1024*1024),{headers:{'content-type':'text/plain'}}) }}),
    usage:async()=>({plan:'Fixture plan',balance:'72 credits',windows:[{name:'Credits',amount:28,limit:100,unit:'credits',used:28}]}),
    checkin:async()=>({outcome:'claimed',credit:1,streak:1})
  },
  provider:{id:'workbuddy',models:async(p,{auth})=>auth?.key==='fixture-second-api-secret'?{'openai-model':p.models['openai-model']}:p.models}
});
`,
);
await writeFile(
  join(directory, "plugins.json"),
  JSON.stringify({
    plugins: { [packageName]: { version: "1.0.0", enabled: true } },
    domesticMirror: false,
    options: {},
  }),
);
const runtime = new SubscriptionPluginRuntime({
  stateDirectory: directory,
  resourcesDirectory: resolve(import.meta.dirname, "../resources/subscription-plugins"),
  bunExecutable: () => process.execPath,
});
const checks: string[] = [];
const bridge = new SubscriptionModelBridge(runtime);
try {
  let state = await runtime.refresh();
  const provider = state.providers.find((item) => item.id === "workbuddy");
  assert(provider);
  assert.equal(provider.signedIn, false);
  assert.deepEqual(provider.models, []);
  checks.push("signed-out providers expose no models");
  state = await runtime.startLogin({ providerId: "workbuddy", methodIndex: 0 });
  let login = state.logins.at(-1);
  assert(login);
  assert.equal(login.prompt?.key, "region");
  state = await runtime.submitLogin({ loginId: login.id, value: "cn" });
  login = state.logins.at(-1);
  assert(login);
  assert.equal(login.status, "waiting");
  assert.equal(login.manualCode, true);
  state = await runtime.submitLogin({ loginId: login.id, value: "fixture-code" });
  assert.equal(state.providers[0]?.signedIn, true);
  assert.equal(state.providers[0]?.models[0]?.id, "live-model");
  assert.equal(runtime.providerDescriptors()[0]?.models[0]?.npm, "@ai-sdk/anthropic");
  assert(!JSON.stringify(state).includes("fixture-access-secret"));
  assert(!JSON.stringify(state).includes("fixture-refresh-secret"));
  checks.push("prompt, code authorization and live model metadata; secrets stay private");
  const loaded = await runtime.loadProvider("workbuddy");
  assert.equal(loaded.baseURL, "https://fixture.invalid");
  const response = await runtime.fetchRequest({
    provider: "workbuddy",
    model: "live-model",
    npm: "@ai-sdk/anthropic",
    url: "https://fixture.invalid/v1/messages",
    method: "POST",
    headers: {},
    body: new TextEncoder().encode("{}"),
  });
  assert.equal((await response.text()).length, 1024 * 1024);
  checks.push("native auth and 1 MiB streaming across credit-window backpressure");
  await bridge.start();
  const configs = bridge.configs();
  assert.equal(configs.length, 2);
  for (const config of configs) {
    const nativePath = config.api === "anthropic-messages" ? "/v1/messages" : "/chat/completions";
    const url = config.baseUrl + nativePath;
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
    const model = config.models[0];
    assert(model);
    const native = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.id, messages: [{ role: "user", content: "Fixture" }], stream: true }),
    });
    assert.equal(native.status, 200);
    assert.equal((await native.text()).length, 1024 * 1024);
  }
  checks.push("private loopback token enforcement and native Anthropic/OpenAI streams through DSH bridge");
  state = await runtime.getUsage({ providerId: "workbuddy" });
  assert.equal(state.providers[0]?.accounts[0]?.usage?.windows[0]?.remaining, 72);
  await runtime.checkIn({ providerId: "workbuddy" });
  checks.push("live plan usage and check-in");
  state = await runtime.startLogin({ providerId: "workbuddy", methodIndex: 0 });
  login = state.logins.at(-1);
  assert(login);
  state = await runtime.submitLogin({ loginId: login.id, value: "cn" });
  await runtime.cancelLogin({ loginId: login.id });
  await assert.rejects(runtime.submitLogin({ loginId: login.id, value: "fixture-code" }));
  checks.push("cancelled login cannot submit a late code");
  state = await runtime.setEnabled({ packageName, enabled: false });
  assert.equal(state.providers.length, 0);
  assert.equal(runtime.providerDescriptors().length, 0);
  state = await runtime.setEnabled({ packageName, enabled: true });
  assert.equal(state.providers[0]?.signedIn, true);
  state = await runtime.signOut({ providerId: "workbuddy" });
  assert.deepEqual(state.providers[0]?.models, []);
  checks.push("disable, reconnect persisted credentials and sign out");
  state = await runtime.startLogin({ providerId: "workbuddy", methodIndex: 1 });
  login = state.logins.at(-1);
  assert(login);
  assert.equal(login.prompt?.secret, true);
  state = await runtime.submitLogin({ loginId: login.id, value: "fixture-user-api-secret" });
  assert.equal(state.providers[0]?.signedIn, true);
  assert(!JSON.stringify(state).includes("fixture-user-api-secret"));
  assert.equal(state.providers[0]?.accounts[0]?.usage, undefined);
  checks.push("API methods request a private key without putting it in prompt metadata; sign-out clears allowance");
  state = await runtime.startLogin({ providerId: "workbuddy", methodIndex: 2 });
  login = state.logins.at(-1);
  assert(login);
  assert.equal(login.url, undefined);
  await runtime.cancelLogin({ loginId: login.id });
  checks.push("local CLI authorization omits absent browser URL");
  await runtime.setOptions({ providerId: "workbuddy", values: { "fixture-option": true } });
  state = await runtime.setOptions({ providerId: "workbuddy", values: { "other-option": true } });
  assert.equal(state.providers[0]?.options.find((option) => option.key === "fixture-option")?.value, true);
  assert.equal(state.providers[0]?.options.find((option) => option.key === "other-option")?.value, true);
  checks.push("partial option changes preserve other saved options");
  state = await runtime.startLogin({ providerId: "workbuddy", methodIndex: 1 });
  login = state.logins.at(-1);
  assert(login);
  state = await runtime.submitLogin({ loginId: login.id, value: "fixture-second-api-secret" });
  const accounts = state.providers[0]?.accounts;
  assert(accounts?.length === 2);
  const first = accounts[0];
  const second = accounts[1];
  assert(first && second);
  assert.deepEqual(second.models, ["openai-model"]);
  assert.deepEqual(runtime.providerDescriptors()[0]?.accounts[1]?.models, ["openai-model"]);
  checks.push("second-account model entitlement remains isolated in native descriptors");
  for (const account of [first, second]) {
    const model = account.models[0];
    assert(model);
    await assert.rejects(
      runtime.fetchRequest({
        provider: "workbuddy",
        account: account.id,
        model,
        npm: "@ai-sdk/anthropic",
        url: "https://fixture.invalid/v1/messages",
        method: "POST",
        headers: {},
        body: new TextEncoder().encode("expire-fixture"),
      }),
    );
    const deadline = Date.now() + 5000;
    do {
      state = await runtime.getState();
      if (state.providers[0]?.accounts.find((item) => item.id === account.id)?.models.length === 0) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    } while (Date.now() < deadline);
    assert.equal(state.providers[0]?.accounts.find((item) => item.id === account.id)?.models.length, 0);
  }
  assert.equal(state.providers[0]?.signedIn, false);
  assert.deepEqual(bridge.configs(), []);
  checks.push("native auth-expiry events refresh cached UI and revoke DSH endpoints without manual refresh");
  for (let index = 0; index < 140; index++) {
    state = await runtime.startLogin({
      providerId: "workbuddy",
      methodIndex: 1,
      inputs: { secret: "fixture-transient-secret" },
    });
    const draft = state.logins.at(-1);
    assert(draft);
    state = await runtime.cancelLogin({ loginId: draft.id });
    assert(state.logins.length <= 16);
    assert(!JSON.stringify(state.logins).includes("fixture-transient-secret"));
    assert(state.logins.every((entry) => !entry.prompt && !entry.code && !entry.url));
  }
  const activeLogins = [];
  for (let index = 0; index < 8; index++) {
    state = await runtime.startLogin({ providerId: "workbuddy", methodIndex: 1 });
    const draft = state.logins.at(-1);
    assert(draft);
    activeLogins.push(draft.id);
  }
  await assert.rejects(runtime.startLogin({ providerId: "workbuddy", methodIndex: 1 }));
  for (const loginId of activeLogins) await runtime.cancelLogin({ loginId });
  checks.push("140 terminal logins retain only 16 scrubbed records; at most eight active authorizations");
  const unavailable = new SubscriptionPluginRuntime({
    stateDirectory: join(directory, "missing-runtime"),
    resourcesDirectory: resolve(import.meta.dirname, "../resources/subscription-plugins"),
    bunExecutable: () => join(directory, "missing-bun.exe"),
  });
  assert.equal((await unavailable.getState()).runtimeAvailable, false);
  await unavailable.stop();
  checks.push("missing Bun executable is unavailable before attempting an authorization");
  const badResources = join(directory, "failing-resources");
  await mkdir(badResources, { recursive: true });
  await writeFile(join(badResources, "host.js"), "process.exit(2);");
  const failedHost = new SubscriptionPluginRuntime({
    stateDirectory: join(directory, "failed-runtime"),
    resourcesDirectory: badResources,
    bunExecutable: () => process.execPath,
  });
  assert.equal((await failedHost.refresh()).runtimeAvailable, false);
  assert.equal((await failedHost.getState()).runtimeAvailable, false);
  await failedHost.stop();
  checks.push("a failed host startup stays unavailable until a successful retry");
  state = await runtime.remove({ packageName });
  assert.equal(state.plugins.find((item) => item.packageName === packageName)?.installedVersion, null);
  assert.equal(state.providers.length, 0);
  checks.push("plugin removal revokes models and installed state");
  await writeFile(join(output, "report.json"), JSON.stringify({ ok: true, checks }, null, 2));
  process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
} finally {
  await bridge.stop();
  await runtime.stop();
  assert(directory.startsWith(`${output}\\`) || directory.startsWith(`${output}/`));
  await rm(directory, { recursive: true, force: true });
}
