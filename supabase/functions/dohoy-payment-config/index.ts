import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {stripeMode,stripeKey} from './mode.js';
import {stripeRequestFor} from './stripe-api.js';
const headers={'Access-Control-Allow-Origin':'https://www.dohoy.com.mx','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-dohoy-version','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 try{
  if(req.method==='GET')return reply({test_mode:!stripeMode(),live_key_configured:/^(sk|rk)_live_/.test(Deno.env.get('STRIPE_LIVE_SECRET_KEY')||''),live_signature_configured:!!Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET'),client_version:'5.1.0'});
  if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
  const auth=req.headers.get('authorization')||'';
  const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_ANON_KEY')||'',{global:{headers:{Authorization:auth}}});
  const {data,error}=await client.auth.getUser();if(error||!data.user)return reply({error:'Inicia sesión.'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'');
  const {data:profile,error:pe}=await admin.from('profiles').select('is_admin,is_suspended').eq('id',data.user.id).single();
  if(pe||!profile?.is_admin||profile.is_suspended)return reply({error:'Solo el administrador puede revisar producción.'},403);
  stripeKey(true);const balance=await stripeRequestFor(true)('/v1/balance');
  if(balance.livemode!==true)throw Error('Stripe devolvió otro entorno.');
  return reply({ok:true,live_key_verified:true,live_signature_configured:true,test_mode:!stripeMode(),message:'Clave real verificada con Stripe. Falta verificar cobro, cuenta del trabajador y transferencia.'});
 }catch(e){return reply({error:e instanceof Error?e.message:'No pudimos verificar Stripe.'},503);}
});
