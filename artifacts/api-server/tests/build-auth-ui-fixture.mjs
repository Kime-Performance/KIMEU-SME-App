// Isolated browser harness: real React screens/bridges, fake Auth and API.
// Never served as an app route, never enabled by an environment flag, and no
// external Auth/SQL calls. Outputs go to the ignored generated-artifacts tree.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const root = process.cwd();
const frontend = resolve(root, "artifacts/kimeu-sme-app");
const output = resolve(root, "generated-artifacts/auth-ui-fixture");
const frontendRequire = createRequire(resolve(frontend, "package.json"));
await mkdir(output, { recursive: true });
const sdk = `
const user={id:"fixture-user",email:"staff@fixture.test",email_confirmed_at:"2026-01-01"};
let session=new URLSearchParams(window.location.search).get("signed")==="yes"?{user,access_token:"fixture-only-token"}:null;
const listeners=new Set();
function change(value){session=value;for(const cb of listeners)cb(value?"SIGNED_IN":"SIGNED_OUT",value)}
export function createClient(){return {auth:{
 getSession:async()=>({data:{session},error:null}),
 getUser:async()=>({data:{user:session?.user??null},error:null}),
 onAuthStateChange:cb=>{listeners.add(cb);return{data:{subscription:{unsubscribe:()=>listeners.delete(cb)}}}},
 signInWithPassword:async({email,password})=>{
   if(email!=="staff@fixture.test"||password!=="fixture-password")return{data:{user:null,session:null},error:{code:"invalid_credentials"}};
   change({user,access_token:"fixture-only-token"});return{data:{user,session},error:null};
 },
 signOut:async()=>{change(null);return{error:null}},
 updateUser:async()=>({data:{user},error:null}),
 verifyOtp:async()=>({data:{user:null,session:null},error:{code:"otp_expired"}}),
 exchangeCodeForSession:async()=>({data:{user:null,session:null},error:{code:"invalid_grant"}})
}}}
`;
const source = `
import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {Router,Route,Switch,Link} from "wouter";
import {memoryLocation} from "wouter/memory-location";
import {SupabaseAuthBridge,useAppAuth} from "./src/auth/auth-context";
import {SupabaseSignInPage,SupabaseRecoveryRequestPage,SupabaseCallbackPage,SupabaseGate} from "./src/pages/supabase-auth";
class FixtureBoundary extends React.Component{
 constructor(props){super(props);this.state={error:null}}
 static getDerivedStateFromError(error){return{error}}
 render(){return this.state.error?<pre data-testid="fixture-error">{String(this.state.error.stack||this.state.error)}</pre>:this.props.children}
}
const query=new URLSearchParams(window.location.search);
const location=memoryLocation({path:query.get("screen")==="callback"?"/auth/recovery":query.get("signed")==="yes"?"/today":"/sign-in"});
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
let denial=null;
window.fetch=async(input,options)=>{
 const url=String(input);
 if(url.includes("/api/auth/supabase/recovery")){
  window.__recoveryCalls=(window.__recoveryCalls||0)+1;
  return new Response(JSON.stringify({message:"If that account exists, we've emailed a reset link."}),{status:202,headers:{"Content-Type":"application/json"}});
 }
 if(url.includes("/api/auth/supabase/session")){
  if(denial)return new Response(JSON.stringify({code:denial,error:denial==="ACCOUNT_PENDING"?"Your account is pending setup.":"Sign in to continue."}),{status:denial==="ACCOUNT_PENDING"?403:401,headers:{"Content-Type":"application/json"}});
  return new Response(JSON.stringify({provider:"supabase",email:"sync-roster@fixture.test",siteRole:"RD",roles:[],personId:null,workshopIds:[]}),{status:200,headers:{"Content-Type":"application/json"}});
 }
 throw new Error("External network forbidden in isolated auth fixture: "+url);
};
function Controls(){
 const auth=useAppAuth();
 return <div style={{padding:16,borderBottom:"2px solid black",background:"#fff"}}>
 <strong>ISOLATED AUTH TEST — NO LIVE ACCOUNTS OR DATA</strong>
 <span data-testid="fixture-status"> {auth.status} </span>
 <button data-testid="fixture-revoke" onClick={()=>{denial="SIGN_IN_REQUIRED";void client.invalidateQueries()}}>Simulate revoked session</button>
 <button data-testid="fixture-pending" onClick={()=>{denial="ACCOUNT_PENDING";void client.invalidateQueries()}}>Simulate pending binding</button>
 <button data-testid="fixture-logout" onClick={()=>void auth.signOut()}>Sign out</button>
 </div>;
}
function Workspace(){return <SupabaseGate><main data-testid="fixture-workspace">Verified RD workspace with no person binding or assignments</main></SupabaseGate>}
createRoot(document.getElementById("root")).render(<FixtureBoundary>
 <Router hook={location.hook}><QueryClientProvider client={client}><SupabaseAuthBridge><Controls/><Switch>
 <Route path="/sign-in" component={SupabaseSignInPage}/>
 <Route path="/auth/recovery-request" component={SupabaseRecoveryRequestPage}/>
 <Route path="/auth/recovery">{()=><SupabaseCallbackPage kind="recovery"/>}</Route>
 <Route path="/today" component={Workspace}/>
 <Route><Link href="/sign-in">Return to sign in</Link></Route>
 </Switch></SupabaseAuthBridge></QueryClientProvider></Router></FixtureBoundary>
);
`;
await build({
  stdin: { contents: source, loader: "tsx", resolveDir: frontend },
  bundle: true, platform: "browser", format: "esm", outfile: resolve(output, "fixture.js"),
  jsx: "automatic",
  define: {
    "import.meta.env": JSON.stringify({
      BASE_URL: "/", VITE_SUPABASE_URL: "https://mzuitumuqidunwkaaxtz.supabase.co",
      VITE_SUPABASE_ANON_KEY: "fixture-not-a-real-anon-key", VITE_AUTH_PROVIDER: "supabase",
    }),
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
  alias: {
    "@": resolve(frontend, "src"),
    react: dirname(frontendRequire.resolve("react/package.json")),
    "react-dom/client": frontendRequire.resolve("react-dom/client"),
    "react-dom": dirname(frontendRequire.resolve("react-dom/package.json")),
    "@tanstack/react-query": frontendRequire.resolve("@tanstack/react-query"),
  },
  plugins: [{ name: "isolated-auth-provider", setup(b) {
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "supabase", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: sdk }));
  } }],
});
await writeFile(resolve(output, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Isolated KIMEU authentication test</title><link rel="stylesheet" href="/src/index.css?direct"><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>`);
console.log("Fixture built under generated-artifacts/auth-ui-fixture (no live credentials).");
