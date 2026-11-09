import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAIClient} from '../lib/openai.js';
test('Responses : clé backend, paramètres imposés et extraction de texte sans métadonnées',async()=>{
 const client=new OpenAIClient({apiKey:'secret-server',model:'test-model',transport:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.headers.Authorization,'Bearer secret-server');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.input,'Bonjour');assert.equal(body.model,'test-model');assert.equal(body.store,false);assert.equal(body.max_output_tokens,2048);assert.equal(body.tools,undefined);
  return new Response(JSON.stringify({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'Réponse'}]}],usage:{input_tokens:10,output_tokens:4},private:'NEVER_RETURN'}));
 }});
 const result=await client.respond(' Bonjour ');assert.equal(result.text,'Réponse');assert.equal(result.complete,true);assert.equal(result.usage.outputTokens,4);assert.ok(!JSON.stringify(result).includes('NEVER_RETURN'));
});
test('clé absente et entrée invalide : aucun appel payant',async()=>{
 let calls=0;const client=new OpenAIClient({apiKey:'',transport:async()=>{calls++;}});
 await assert.rejects(()=>client.respond('bonjour'),e=>e.status===503);await assert.rejects(()=>client.respond(' '),e=>e.status===400);await assert.rejects(()=>client.respond('a'.repeat(8001)),e=>e.status===400);assert.equal(calls,0);
});
test('erreurs fournisseur et réseau ne renvoient ni corps brut ni secret',async()=>{
 for(const status of [401,403,429,500]){
  const client=new OpenAIClient({apiKey:'secret',transport:async()=>new Response('NEVER_RETURN secret',{status})});
  await assert.rejects(()=>client.respond('test'),e=>!e.message.includes('secret')&&!e.message.includes('NEVER_RETURN')&&e.status===(status===429?429:502));
 }
 const timeout=new OpenAIClient({apiKey:'secret',transport:async()=>{throw Object.assign(new Error('secret'),{name:'TimeoutError'});}});
 await assert.rejects(()=>timeout.respond('test'),e=>e.status===504&&!e.message.includes('secret'));
});
test('réponse incomplète ou refus signalés explicitement',async()=>{
 for(const status of ['completed','incomplete']){
  const c=new OpenAIClient({apiKey:'secret',transport:async()=>new Response(JSON.stringify({status,output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Demande refusée'}]}]}))});
  const result=await c.respond('test');assert.equal(result.refused,true);assert.equal(result.complete,status==='completed');
 }
});
