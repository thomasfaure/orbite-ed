import {EdError} from './ecoledirecte.js';

export class OpenAIClient {
  constructor({apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL || 'gpt-5-mini',transport=fetch}={}) {
    this.apiKey=apiKey?.trim();this.model=model;this.fetch=transport;
  }
  get configured(){return !!this.apiKey;}
  async respond(input) {
    if(typeof input!=='string' || !input.trim() || input.length>8000)throw new EdError('Le texte doit contenir entre 1 et 8 000 caractères.',400);
    if(!this.configured)throw new EdError('OpenAI n’est pas configuré sur le serveur.',503);
    let response,body;
    try {
      response=await this.fetch('https://api.openai.com/v1/responses',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
        headers:{Authorization:'Bearer '+this.apiKey,'Content-Type':'application/json'},
        body:JSON.stringify({model:this.model,input:input.trim(),store:false,max_output_tokens:2048,
          instructions:'Réponds en français, clairement et brièvement. Tu es un assistant du tableau de bord familial Orbite. Ne prétends pas accéder à des données qui ne figurent pas dans la demande.'})
      });
    }catch(error){throw new EdError(error.name==='TimeoutError'||error.name==='AbortError'?'OpenAI met trop de temps à répondre. Réessayez.':'OpenAI est momentanément injoignable.',504);}
    if(!response.ok){
      const message=response.status===429?'Limite ou quota OpenAI atteint. Réessayez plus tard.':[401,403].includes(response.status)?'La configuration OpenAI du serveur doit être vérifiée.':'La requête OpenAI a échoué.';
      throw new EdError(message,response.status===429?429:502);
    }
    try{body=await response.json();}catch{throw new EdError('Réponse OpenAI non reconnue.',502);}
    if(!['completed','incomplete'].includes(body.status)||!Array.isArray(body.output))throw new EdError('Réponse OpenAI indisponible.',502);
    const parts=body.output.filter(item=>item.type==='message'&&item.role==='assistant').flatMap(item=>Array.isArray(item.content)?item.content:[]);
    const text=parts.map(part=>part.type==='output_text'?part.text:part.type==='refusal'?part.refusal:'').filter(value=>typeof value==='string').join('\n').trim();
    if(!text)throw new EdError(body.status==='incomplete'?'La réponse dépasse la limite autorisée. Reformulez une demande plus courte.':'OpenAI n’a pas renvoyé de texte.',502);
    const number=value=>Number.isFinite(value)&&value>=0?value:null;
    return {text,complete:body.status==='completed',refused:parts.some(p=>p.type==='refusal'),usage:{inputTokens:number(body.usage?.input_tokens),outputTokens:number(body.usage?.output_tokens)}};
  }
}
