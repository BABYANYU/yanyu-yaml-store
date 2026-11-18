import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.CLOUDFLARE_API_TOKEN;
const namespace=process.env.KV_NAMESPACE_ID;
const checkpoint=process.env.PRODUCTION_CHECKPOINT;
assert.match(account??'',/^[a-f0-9]{32}$/i);
assert.match(namespace??'',/^[a-f0-9]{32}$/i);
assert.ok(token&&checkpoint,'Missing production guard configuration');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
async function get(path){
 const r=await fetch(base+path,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 let d;try{d=await r.json();}catch{throw Error('Cloudflare returned an invalid response');}
 assert.ok(r.ok&&d.success,'Cloudflare preflight/read verification failed');return d.result;
}
const settings=await get('/workers/scripts/pb/settings');
const bindings=settings.bindings??[];
const pb=bindings.filter(b=>b.type==='kv_namespace'&&b.name==='PB');
assert.equal(pb.length,1,'Expected exactly one PB binding');
assert.equal(pb[0].namespace_id,namespace,'PB must retain the configured original namespace');
const variables=bindings.filter(b=>['plain_text','json','secret_text'].includes(b.type)).sort((a,b)=>a.name.localeCompare(b.name));
const fingerprint=createHash('sha256').update(JSON.stringify(variables)).digest('hex');
// Only list key metadata. Never read, write, import, restore or delete any paste value.
let cursor;const keys=[];
do{
 const u=new URL(base+`/storage/kv/namespaces/${namespace}/keys`);u.searchParams.set('limit','1000');if(cursor)u.searchParams.set('cursor',cursor);
 const r=await fetch(u,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 const d=await r.json();assert.ok(r.ok&&d.success&&Array.isArray(d.result),'KV metadata listing failed');
 for(const k of d.result)keys.push({name:k.name,expiration:k.expiration??null});
 const next=d.result_info?.cursor;assert.ok(!next||next!==cursor,'KV listing cursor repeated');cursor=next;
 assert.ok(keys.length<=100000,'Excessive inventory; stop for manual review');
}while(cursor);
if(process.argv[2]==='before'){
 const subdomain=await get('/workers/scripts/pb/subdomain');
 await writeFile(checkpoint,JSON.stringify({namespace,fingerprint,keys}),{mode:0o600});
 const output=process.env.GITHUB_OUTPUT;
 assert.ok(output);await writeFile(output,`workers_dev=${Boolean(subdomain.enabled)}\npreview_urls=${Boolean(subdomain.previews_enabled)}\n`,{flag:'a'});
 console.log(`Preflight verified: existing pb/PB binding, ${keys.length} original key metadata entries. No paste values accessed.`);
}else if(process.argv[2]==='after'){
 const before=JSON.parse(await readFile(checkpoint,'utf8'));
 assert.equal(before.namespace,namespace);assert.equal(before.fingerprint,fingerprint,'Production variables must remain unchanged');
 const present=new Set(keys.map(k=>k.name)),now=Math.floor(Date.now()/1000);
 const missing=before.keys.filter(k=>(k.expiration===null||k.expiration>now)&&!present.has(k.name));
 assert.equal(missing.length,0,'Original unexpired keys missing; stop and investigate (do not restore or delete data automatically)');
 console.log(`Post-deploy verified: same PB namespace and variables; ${keys.length} keys currently listed; no original unexpired key missing. Metadata checks are not a byte-for-byte value proof.`);
}else throw Error('Expected before or after');
