import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BASE_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};
// Parse response bodies safely
async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
async function lookup(table, filter, select = "*") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=${
    encodeURIComponent(select)
  }`;
  const res = await fetch(url, {
    headers: BASE_HEADERS,
  });
  if (!res.ok) {
    throw new Error(
      `${table} lookup failed: ${res.status} ${await res.text()}`,
    );
  }
  return await parseBody(res);
}
async function create(table, payload) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const headers = {
    ...BASE_HEADERS,
    Prefer: "return=representation",
  }; // ensure created row is returned
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      `${table} create failed: ${res.status} ${await res.text()}`,
    );
  }
  const parsed = await parseBody(res);
  // Supabase returns an array for inserts by default; return first element or object
  if (!parsed) throw new Error(`${table} create returned empty body`);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}
async function patch(table, filter, payload) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const headers = {
    ...BASE_HEADERS,
    Prefer: "return=representation",
  }; // get updated row back
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`${table} patch failed: ${res.status} ${await res.text()}`);
  }
  const parsed = await parseBody(res);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
    });
  }
  try {
    const { from, subject, body } = await req.json();
    if (!from || !subject && !body) {
      return new Response("Missing required fields", {
        status: 400,
      });
    }
    // 1) Find or create user
    const users = await lookup(
      "users",
      `email=eq.${encodeURIComponent(from)}`,
      "id",
    );
    let userId;
    if (Array.isArray(users) && users.length && users[0]?.id) {
      userId = users[0].id;
    } else {
      const createdUser = await create("users", {
        email: from,
      });
      if (!createdUser || !createdUser.id) {
        throw new Error("User creation did not return id");
      }
      userId = createdUser.id;
    }
    // 2) Find or create conversation for that user
    const convs = await lookup(
      "conversations",
      `user_id=eq.${encodeURIComponent(userId)}`,
      "id",
    );
    let convoId;
    if (Array.isArray(convs) && convs.length && convs[0]?.id) {
      convoId = convs[0].id;
    } else {
      const createdConv = await create("conversations", {
        user_id: userId,
      });
      if (!createdConv || createdConv.id == null) {
        throw new Error("Conversation creation did not return id");
      }
      convoId = createdConv.id;
    }
    // 3) Insert message (ensure representation returned)
    const createdMsg = await create("messages", {
      user_id: userId,
      direction: "inbound",
      subject: subject ?? null,
      body: body ?? null,
    });
    // New: line up a response for later
    // Handled via a cron job a few minutes later
    await create("pending_replies", {
      email: from,
      message_id: createdMsg.id,
    });
    // 4) Update conversation timestamp (best-effort)
    await patch("conversations", `id=eq.${encodeURIComponent(convoId)}`, {
      last_message_at: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({
        ok: true,
        message: createdMsg,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("Inbound error:", err);
    return new Response("Server error", {
      status: 500,
    });
  }
});
