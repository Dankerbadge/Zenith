// Supabase Edge Function: delete-me
// Deletes the authenticated user's server account + associated data.
//
// Mode A contract (Zenith):
// - Client calls this while still authenticated.
// - If this succeeds, client proceeds to local wipe and logout.
// - If this fails, client must not wipe local automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Server misconfigured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing bearer token." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // User client (to resolve the caller).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userData.user.id;

    // Service client (to delete data + auth user).
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // Domain deletes:
    // - Skip only when the table does not exist (deployable across envs).
    // - Any other error is a hard failure (do NOT delete auth user).
    const isMissingTableError = (err: unknown) => {
      const code = String((err as any)?.code || "").toLowerCase();
      const msg = String((err as any)?.message || err || "").toLowerCase();

      // Postgres: 42P01 undefined_table (common missing-table case).
      if (code === "42p01" || code.includes("undefined_table") || msg.includes("42p01") || msg.includes("undefined_table")) return true;

      // Text match fallback: require both keywords to avoid false-skips.
      return msg.includes("does not exist") && msg.includes("relation");
    };

    const deleteOrSkipMissingTable = async (table: string, filter: Record<string, string>) => {
      try {
        let q = admin.from(table).delete();
        for (const [col, val] of Object.entries(filter)) {
          q = q.eq(col, val);
        }
        const { error } = await q;
        if (error) {
          if (isMissingTableError(error)) return;
          throw { table, error };
        }
      } catch (err) {
        if (isMissingTableError(err)) return;
        throw { table, error: err };
      }
    };

    // Social + core profile rows.
    try {
      await deleteOrSkipMissingTable("likes", { user_id: userId });
      await deleteOrSkipMissingTable("comments", { user_id: userId });
      await deleteOrSkipMissingTable("posts", { user_id: userId });
      await deleteOrSkipMissingTable("follows", { follower_id: userId });
      await deleteOrSkipMissingTable("follows", { following_id: userId });
      await deleteOrSkipMissingTable("team_members", { user_id: userId });
      await deleteOrSkipMissingTable("activity_feed", { actor_id: userId });

      // Garmin companion tables (privacy/trust): ensure no orphaned rows.
      await deleteOrSkipMissingTable("garmin_workout_summaries", { user_id: userId });
      await deleteOrSkipMissingTable("garmin_link_tokens", { user_id: userId });
      await deleteOrSkipMissingTable("garmin_device_links", { user_id: userId });

      // Phase 29 privacy controls.
      await deleteOrSkipMissingTable("food_v2_user_data_explanation", { user_id: userId });
      await deleteOrSkipMissingTable("food_v2_public_shares", { user_id: userId });
      await deleteOrSkipMissingTable("food_v2_user_consent", { user_id: userId });
      await deleteOrSkipMissingTable("food_v2_privacy_audit_events", { user_id: userId });

      // Profile row last (some schemas may have FK constraints to profiles).
      await deleteOrSkipMissingTable("profiles", { id: userId });
    } catch (err) {
      const table = String((err as any)?.table || "");
      return new Response(
        JSON.stringify({ ok: false, error: "Domain delete failed.", stage: "domain_delete", table: table || null }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Finally, delete the auth user.
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return new Response(
        JSON.stringify({ ok: false, error: "Could not delete auth user." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (_err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Unhandled delete failure." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
