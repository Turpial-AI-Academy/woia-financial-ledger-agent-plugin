import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { emptyLedger, planLedger, executeLedger, commandDigest, representationDigest } from '../skills/woia-financial-ledger/scripts/ledger.mjs';

function fixture(represented=false) {
 const scope={org_id:'org',scope_id:'scope',currency:'USD',scale:2,beneficiary_ref:'beneficiary',custody_ref:'custody',purpose:'service'};
 const command={action:'finance.charge.create',org_id:'org',scope_id:'scope',id:'charge',operation_key:'operation',expected_revision:0,payload:{scope,amount:'100',source_contract_ref:'contract',source_business_key:'business-key',debtor_ref:'debtor',concept:'service',period:'period',...(represented?{represented_principal_ref:'principal'}:{})}};
 const hash=commandDigest(command);
 const authority={actor:{authenticated:true,id:'actor',task_id:'task',department:'Finance'},current:true,org_id:'org',scope_id:'scope',provider:'woia-financial-ledger',policy:{version:'1',digest:'policy',valid_from:0,valid_until:100,revoked:false,emergency_stop:false},grant:{action:command.action,command_digest:hash,revoked:false,valid_from:0,valid_until:100},hold:false,source_conflict:false,aggregate_limit_checked:true,expected_revision:0,writer_fence:'fence',decision:'POLICY_GOVERNED',representation:{applicable:false}};
 if(represented){
  authority.representation={applicable:true,authenticated:true,accepted:true,current:true,principal_ref:'principal',grant_ref:'grant',source_ref:'representation-source',revision:'1',org_id:'org',scope_id:'scope',task_id:'task',action:command.action,command_digest:hash,valid_from:0,valid_until:100,revoked:false};
  authority.representation.digest_sha256=representationDigest(authority.representation);
 }
 const source={accepted:true,conflict:false,org_id:'org',scope_id:'scope',command_digest:hash,evidence_ref:'evidence',authority_map_version:'1',valid_from:0,valid_until:100};
 return {state:emptyLedger('org','scope'),command,authority,source,now:10};
}
const plan=f=>planLedger(f.state,f.command,f.authority,f.source,f.now);

test('own-authority and accepted representation both retain sourced immutable monetary facts',()=>{
 for(const represented of [false,true]){
  const f=fixture(represented),result=plan(f);
  assert.equal(result.state.charges[0].amount,'100');assert.ok(Object.isFrozen(result.state));
  assert.equal(f.state.revision,0);
 }
});
test('missing applicability, self-claimed principal and changed representation denied',()=>{
 const missing=fixture();delete missing.authority.representation;
 assert.throws(()=>plan(missing),/REPRESENTATION_APPLICABILITY_REQUIRED/);
 const claimed=fixture(true);claimed.authority.representation={applicable:false};
 assert.throws(()=>plan(claimed),/REPRESENTATION_GRANT_REQUIRED/);
 for(const mutate of [proof=>proof.current=false,proof=>proof.task_id='foreign',proof=>proof.valid_until=10,proof=>proof.revision='',proof=>proof.source_ref='changed',proof=>proof.principal_ref='changed',proof=>proof.command_digest='different']){
  const f=fixture(true);mutate(f.authority.representation);
  assert.throws(()=>plan(f),/CURRENT_REPRESENTATION_GRANT_REQUIRED/);
 }
});
test('command payload cannot inject trusted representation provenance',()=>{
 const f=fixture();f.command.payload.representation_grant={principal_ref:'self-claimed'};
 f.authority.grant.command_digest=commandDigest(f.command);
 assert.throws(()=>plan(f),/TRUSTED_REPRESENTATION_PROVENANCE_REQUIRED/);
});
test('representation cannot bypass authority digest, Finance ownership, source or fence',()=>{
 for(const mutate of [f=>f.authority.grant.command_digest='different',f=>f.authority.actor.department='Sales',f=>f.source.accepted=false,f=>f.authority.writer_fence='']){
  const f=fixture(true);mutate(f);
  assert.throws(()=>plan(f),/EXACT_GRANT_REQUIRED|FINANCE_ONLY|ACCEPTED_FRESH_SOURCE_REQUIRED|REVISION_FENCE_REQUIRED/);
 }
});
test('qualified commit receives exact proof and CAS rejection publishes no facts',async()=>{
 const f=fixture(true);let commit;
 const port={read:async()=>f.state,resolveAuthority:async()=>f.authority,resolveSource:async()=>f.source,now:async()=>f.now,compareAndSwap:async value=>{commit=value;return false}};
 await assert.rejects(executeLedger(port,f.command),/ATOMIC_COMMIT_CONFLICT/);
 assert.equal(commit.authority.representation.digest_sha256,f.authority.representation.digest_sha256);
 assert.equal(commit.writer_fence,'fence');assert.equal(f.state.charges.length,0);
});
test('idempotency rechecks representation before replay',()=>{
 const f=fixture(true),first=plan(f);f.state=first.state;
 f.authority.representation.current=false;
 assert.throws(()=>plan(f),/CURRENT_REPRESENTATION_GRANT_REQUIRED/);
});
test('trusted representation proof schema accepts both explicit applicability decisions',()=>{
 const validate=new Ajv().compile(JSON.parse(readFileSync(new URL('../skills/woia-financial-ledger/schemas/representation.schema.json',import.meta.url),'utf8')));
 for(const represented of [false,true])assert.equal(validate(fixture(represented).authority.representation),true,JSON.stringify(validate.errors));
 assert.equal(validate({}),false);
});
