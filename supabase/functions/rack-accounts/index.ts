// Rack Planner accounts: the only place sign-ins are made, changed or
// removed. It holds the service key, so it checks every caller itself: only
// an admin may do anything, except create the very first admin while there
// is none. Deployed with verify_jwt off for that reason.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ROLES = ["admin", "editor", "viewer"];
// Disabling an account bans its sign-in for a hundred years.
const BAN = "876000h";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

class Refused extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function text(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function checkPassword(p: unknown) {
  if (typeof p !== "string" || p.length < 8) throw new Refused("The password needs at least 8 characters.");
  return p;
}

function checkEmail(e: unknown) {
  const email = text(e).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refused("That email address does not look right.");
  return email;
}

async function admins() {
  const { data, error } = await sb.from("rack_accounts").select("user_id").eq("role", "admin").eq("disabled", false);
  if (error) throw error;
  return data.map((r) => r.user_id as string);
}

async function caller(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Refused("Sign in first.", 401);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) throw new Refused("Sign in again.", 401);
  const { data: account } = await sb.from("rack_accounts").select("*").eq("user_id", data.user.id).maybeSingle();
  if (!account || account.disabled || account.role !== "admin") throw new Refused("Only an admin can manage accounts.", 403);
  return account;
}

// A sign-in for email, made now, or the one that already exists for it with
// no Rack Planner account attached.
async function makeUser(email: string, password: string, name: string) {
  const made = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (!made.error) return made.data.user!;
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const old = list?.users.find((u) => (u.email || "").toLowerCase() === email);
  if (!old) throw new Refused(made.error.message);
  const { data: taken } = await sb.from("rack_accounts").select("user_id").eq("user_id", old.id).maybeSingle();
  if (taken) throw new Refused(email + " already has an account.");
  const { error } = await sb.auth.admin.updateUserById(old.id, { password, email_confirm: true, ban_duration: "none" });
  if (error) throw error;
  return old;
}

async function addAccount(email: string, password: string, name: string, role: string) {
  const user = await makeUser(email, password, name);
  const { error } = await sb.from("rack_accounts").insert({ user_id: user.id, email, name: name || null, role });
  if (error) throw error;
  return user.id;
}

async function act(req: Request, body: Record<string, unknown>) {
  switch (body.action) {
    case "bootstrap": {
      if ((await admins()).length) throw new Refused("Rack Planner already has an admin.", 409);
      const id = await addAccount(checkEmail(body.email), checkPassword(body.password), text(body.name), "admin");
      return { user_id: id };
    }

    case "list": {
      await caller(req);
      const { data: rows, error } = await sb.from("rack_accounts").select("*").order("created_at");
      if (error) throw error;
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const seen = new Map((list?.users || []).map((u) => [u.id, u.last_sign_in_at]));
      return { accounts: rows.map((r) => ({ ...r, last_sign_in_at: seen.get(r.user_id) || null })) };
    }

    case "create": {
      await caller(req);
      const role = text(body.role);
      if (!ROLES.includes(role)) throw new Refused("Pick a role.");
      const id = await addAccount(checkEmail(body.email), checkPassword(body.password), text(body.name), role);
      return { user_id: id };
    }

    case "update": {
      const me = await caller(req);
      const id = text(body.user_id);
      const { data: target } = await sb.from("rack_accounts").select("*").eq("user_id", id).maybeSingle();
      if (!target) throw new Refused("No such account.", 404);
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = text(body.name) || null;
      if (body.role !== undefined) {
        if (!ROLES.includes(text(body.role))) throw new Refused("Pick a role.");
        patch.role = text(body.role);
      }
      if (body.disabled !== undefined) patch.disabled = !!body.disabled;
      const losesAdmin = target.role === "admin" && !target.disabled &&
        ((patch.role && patch.role !== "admin") || patch.disabled === true);
      if (losesAdmin && (await admins()).length <= 1) throw new Refused("Rack Planner needs at least one admin.");
      if (id === me.user_id && patch.disabled === true) throw new Refused("You cannot disable your own account.");
      const { error } = await sb.from("rack_accounts").update(patch).eq("user_id", id);
      if (error) throw error;
      if (patch.disabled !== undefined) {
        const { error: banError } = await sb.auth.admin.updateUserById(id, { ban_duration: patch.disabled ? BAN : "none" });
        if (banError) throw banError;
      }
      return { ok: true };
    }

    case "set_password": {
      await caller(req);
      const { error } = await sb.auth.admin.updateUserById(text(body.user_id), { password: checkPassword(body.password) });
      if (error) throw error;
      // A "forgot password" request is answered by the new password.
      await sb.from("rack_password_requests").delete().eq("user_id", text(body.user_id));
      return { ok: true };
    }

    case "delete": {
      const me = await caller(req);
      const id = text(body.user_id);
      if (id === me.user_id) throw new Refused("You cannot remove your own account.");
      const { data: target } = await sb.from("rack_accounts").select("role, disabled").eq("user_id", id).maybeSingle();
      if (target && target.role === "admin" && !target.disabled && (await admins()).length <= 1) {
        throw new Refused("Rack Planner needs at least one admin.");
      }
      const { error } = await sb.auth.admin.deleteUser(id);
      if (error) throw error;
      return { ok: true };
    }

    default:
      throw new Refused("Unknown action.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  try {
    const body = await req.json().catch(() => ({}));
    return reply(200, await act(req, body));
  } catch (e) {
    const status = e instanceof Refused ? e.status : 500;
    return reply(status, { error: e instanceof Error ? e.message : String(e) });
  }
});
