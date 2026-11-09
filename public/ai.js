/** Appelle uniquement le serveur Orbite ; aucune clé OpenAI dans le navigateur.
 * Le texte passé en input sera transmis à OpenAI. Rien n'est joint automatiquement.
 * Afficher text via textContent (jamais innerHTML sans assainissement).
 */
export async function askAI(input,{signal}={}) {
  const response=await fetch('/api/ai',{
    method:'POST',credentials:'same-origin',signal,
    headers:{'Content-Type':'application/json','X-Orbite-Client':'1'},
    body:JSON.stringify({input})
  });
  let result;
  try{result=await response.json();}catch{throw new Error('Réponse du serveur non reconnue.');}
  if(!response.ok)throw Object.assign(new Error(result.error || 'La demande IA a échoué.'),{status:response.status});
  return result;
}
