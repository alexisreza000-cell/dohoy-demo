import {stripeMode,stripeKey,accountColumn,requireClient} from './mode.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dohoy-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Método no permitido." }, 405);
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json({ ok: false, error: "No has iniciado sesión." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // Admin-only preparation of a live worker account does not change DOHOY_STRIPE_MODE.
    // Ordinary worker onboarding continues to use the platform's configured mode.
    const payload = await req.json().catch(() => ({})) as { action?: string };
    if (payload.action && payload.action !== "prepare_live") {
      return json({ok:false,error:"Operación no permitida."},400);
    }
    const preparingLive = payload.action === "prepare_live";
    const live=preparingLive ? true : stripeMode();
    requireClient(req,live);
    const stripeSecretKey = stripeKey(live);
    const accountField=accountColumn(live);

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !serviceRoleKey ||
      !stripeSecretKey
    ) {
      throw new Error("Falta configuración segura del servidor.");
    }

    // Cliente autenticado: identifica al usuario que hizo la solicitud.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ ok: false, error: "Sesión inválida." }, 401);
    }

    // Cliente administrativo: solo vive dentro de la Edge Function.
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, full_name, stripe_connect_account_id, stripe_connect_live_account_id, is_admin, is_suspended")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      throw new Error("No se encontró tu perfil de DOHOY.");
    }

    if (profile.is_suspended) {
      return json(
        { ok: false, error: "Esta cuenta está suspendida." },
        403,
      );
    }
    if (preparingLive && !profile.is_admin) {
      return json({ok:false,error:"La preparación de cuentas reales está disponible solo para el administrador."},403);
    }

    let accountId = profile[accountField] as string | null;

    // Accounts v2: los trabajadores reciben transferencias de la plataforma.
    const stripeHeaders = {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/json",
      "Stripe-Version": "2026-09-30.endive",
    };
    async function stripeRequest(path: string, body: unknown, idempotencyKey?: string) {
      const response = await fetch("https://api.stripe.com" + path, {
        method: "POST",
        headers: { ...stripeHeaders, ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("DOHOY Stripe Connect", JSON.stringify({
          code: data?.error?.code,
          message: data?.error?.message,
          request_id: response.headers.get("request-id"),
        }));
        const message = String(data?.error?.message || "Stripe no pudo procesar la solicitud.");
        throw new Error(message.split("curl --request")[0].trim().slice(0, 350));
      }
      return data;
    }

    if (!accountId) {
      const account = await stripeRequest("/v2/core/accounts", {
        ...(user.email ? { contact_email: user.email } : {}),
        identity: { country: "MX" },
        dashboard: "express",
        defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        metadata: { supabase_user_id: user.id, platform: "DOHOY" },
      }, `dohoy-connect-v2-${live?"live":"test"}-${user.id}`);
      if (!account?.id) throw new Error("Stripe no devolvió una cuenta de cobro.");
      accountId = account.id;

      const { data: saved, error: saveError } = await admin
        .from("profiles")
        .update({ [accountField]: accountId, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("id")
        .single();
      if (saveError || !saved) {
        console.error("DOHOY Connect profile save", saveError?.code);
        throw new Error("No pudimos vincular tu cuenta de cobro. Vuelve a intentarlo.");
      }
    }

    // El enlace recoge los requisitos pendientes; regresar no confirma la activación.
    const link = await stripeRequest("/v2/core/account_links", {
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: preparingLive ? "https://www.dohoy.com.mx/?connect=refresh&scope=live" : "https://www.dohoy.com.mx/?connect=refresh",
          return_url: preparingLive ? "https://www.dohoy.com.mx/?connect=complete&scope=live" : "https://www.dohoy.com.mx/?connect=complete",
        },
      },
    });
    if (!link?.url) throw new Error("Stripe no devolvió el formulario de cobros.");

    return json({
      ok: true,
      account_id: accountId,
      onboarding_required: true,
      test_mode: !live,
      onboarding_url: link.url,
    });
  } catch (error) {
    console.error("DOHOY Connect onboarding:", error);

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Ocurrió un error inesperado.",
      },
      400,
    );
  }
});
