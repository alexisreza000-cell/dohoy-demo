import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
// Database webhook uses its own random secret; public JWTs cannot dispatch pushes.
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const {data:config,error:ce}=await db.rpc('web_push_server_config');
 if(ce||!config)return new Response('Configuration unavailable',{status:503});
 const token=req.headers.get('X-DOHOY-Push-Secret')||'';
 if(token.length!==config.webhook_secret.length)return new Response('Unauthorized',{status:401});
 let mismatch=0;for(let i=0;i<token.length;i++)mismatch|=token.charCodeAt(i)^config.webhook_secret.charCodeAt(i);
 if(mismatch)return new Response('Unauthorized',{status:401});
 webpush.setVapidDetails('https://alexisreza000-cell.github.io/dohoy-demo/',config.public_key,config.private_key);
 const {data:jobs,error}=await db.rpc('claim_push_outbox');
 if(error)return new Response('Queue unavailable',{status:503});
 let sent=0;
 for(const job of jobs||[]){
  try{
   const {data:n,error:ne}=await db.from('notifications').select('id,user_id,type').eq('id',job.notification_id).single();if(ne)throw ne;
   const {data:p}=await db.from('notification_preferences').select('*').eq('user_id',n.user_id).maybeSingle();
   const key=n.type==='message'?'messages':n.type==='matching_task'?'matching':/offer|counter/.test(n.type)?'offers':'tasks';
   if(p?.[key]===false){await db.from('push_outbox').update({status:'skipped',updated_at:new Date().toISOString()}).eq('notification_id',job.notification_id);continue}
   const {data:subs,error:se}=await db.from('push_subscriptions').select('*').eq('user_id',n.user_id);if(se)throw se;
   let failed=false;
   for(const sub of subs||[]){
    if(sub.subscription?.preferences?.[key]===false)continue;
    // Only browser push gateways: prevents server-side requests to arbitrary subscription URLs.
    const u=new URL(sub.endpoint),allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
    if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))){await db.from('push_subscriptions').delete().eq('id',sub.id);continue}
    try{
     // Opt-in subscriptions receive a generic alert only. No task, message, title, ID or personal content leaves the app.
     await webpush.sendNotification(sub.subscription,JSON.stringify({title:'DOHOY',body:'Tienes una actualización. Abre DOHOY para verla.',tag:'dohoy-updates',url:'?activity=1'}),{TTL:86400,timeout:10000});sent++;
    }catch(err){if(err.statusCode===404||err.statusCode===410)await db.from('push_subscriptions').delete().eq('id',sub.id);else failed=true}
   }
   await db.from('push_outbox').update({status:failed?'pending':'sent',last_error:failed?'Push gateway temporarily unavailable':null,updated_at:new Date().toISOString()}).eq('notification_id',job.notification_id);
  }catch(_err){await db.from('push_outbox').update({status:'pending',last_error:'Notification could not be processed',updated_at:new Date().toISOString()}).eq('notification_id',job.notification_id)}
 }
 return Response.json({sent});
});
