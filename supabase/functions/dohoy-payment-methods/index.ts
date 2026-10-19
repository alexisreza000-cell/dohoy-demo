import {stripeMode,stripeKey,accountColumn,requireClient} from './mode.js';
import Stripe from "https://esm.sh/stripe@14.25.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(url, service);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dohoy-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...cors,"Content-Type":"application/json"}});

async function authedUser(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data } = await client.auth.getUser();
  return data.user ?? null;
}

async function getOrCreateCustomer(user: any, stripe: any, live: boolean) {
  const { data: existing } = await admin.from(live?"stripe_live_customers":"stripe_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { supabase_user_id: user.id, app: "DOHOY" }
  },{idempotencyKey:`dohoy-customer-${live?"live":"test"}-${user.id}`});
  const { error } = await admin.from(live?"stripe_live_customers":"stripe_customers").insert({
    user_id: user.id,
    stripe_customer_id: customer.id
  });
  if (error) throw error;
  return customer.id;
}

Deno.serve(async (req) => {
  const live=stripeMode();
  if(req.method!=="OPTIONS")requireClient(req,live);
  const stripe=new Stripe(stripeKey(live), {apiVersion:"2023-10-16"});
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await authedUser(req);
  if (!user) return reply({error:"unauthorized"},401);

  try {
    const customerId = await getOrCreateCustomer(user,stripe,live);

    if (req.method === "GET") {
      const methods = await stripe.paymentMethods.list({customer:customerId,type:"card"});
      const cards = methods.data.map(pm => ({
        id: pm.id,
        brand: pm.card?.brand ?? "card",
        last4: pm.card?.last4 ?? "",
        exp_month: pm.card?.exp_month ?? null,
        exp_year: pm.card?.exp_year ?? null
      }));
      return reply({cards});
    }

    if (req.method === "POST") {
      const body = await req.json().catch(()=>({}));
      let returnUrl = "https://alexisreza000-cell.github.io/dohoy-demo/";
      try {
        const raw = body.return_url || req.headers.get("referer") || returnUrl;
        const u = new URL(raw);
        if (u.protocol === "http:" || u.protocol === "https:") returnUrl = u.toString();
      } catch {}

      const success = new URL(returnUrl);
      success.searchParams.set("payment_method","added");

      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: customerId,
        payment_method_types: ["card"],
        success_url: success.toString(),
        cancel_url: returnUrl
      });
      return reply({checkout_url:session.url});
    }

    return reply({error:"method_not_allowed"},405);
  } catch (e) {
    console.error(e);
    return reply({error:"payment_methods_failed"},500);
  }
});
