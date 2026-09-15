// Never forward provider error bodies: they may contain account identifiers.
module.exports=function groqRateError(response,body){
 const raw=String(body?.error?.message||body?.message||'');
 const header=response.headers?.get?.('retry-after');
 let seconds=header&&/^\d+(?:\.\d+)?$/.test(header.trim())?Math.ceil(Number(header)):header?Math.ceil((Date.parse(header)-Date.now())/1000):null;
 seconds=Number.isSafeInteger(seconds)&&seconds>0?seconds:null;
 const tooLarge=/request too large|reduce your message/i.test(raw);
 const daily=!tooLarge&&(/tokens per day|requests per day|\bTPD\b|\bRPD\b|daily/i.test(raw)||response.headers?.get?.('x-ratelimit-remaining-requests')==='0');
 const kind=tooLarge?'request_too_large':daily?'daily':'rate_limit';
 let message=tooLarge?'La demande dépasse la limite Groq de ce modèle. Réduisez la longueur du CV ou de l’offre avant de réessayer.':daily?'Limite quotidienne Groq atteinte. Consultez la date de réinitialisation dans votre console Groq.':'Limite de débit Groq atteinte pour ce modèle.';
 if(seconds&&!tooLarge)message+=' Réessayez dans '+seconds+' secondes.';
 const error=new Error(message);error.status=429;error.rateLimitType=kind;error.retryAfterSeconds=tooLarge?null:seconds;return error;
};
