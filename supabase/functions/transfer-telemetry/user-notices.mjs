// Read-only lookup behind the existing private relay authentication. The
// optional message read lets the old backend keep working during rollout.
export async function lookupNoticeUser(input, { createClient, getEnv, timeoutMs }, headers) {
  const reply = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
  const includeMessage = input.include_message === true;
  if (Object.keys(input).length !== (includeMessage ? 3 : 2) || typeof input.install_id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.install_id))
    return reply(400, { code: "invalid_payload" });
  if (!getEnv("SUPABASE_URL") || !getEnv("SUPABASE_SERVICE_ROLE_KEY"))
    return reply(503, { code: "notices_unavailable" });
  let timer;
  try {
    const client = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }) }
    });
    const result = await Promise.race([(async () => {
      const { data, error } = await client.from("users").select("user_no").eq("install_id", input.install_id).maybeSingle();
      if (error || (data && (!Number.isSafeInteger(data.user_no) || data.user_no < 1))) throw new Error("lookup_failed");
      const userNumber = data?.user_no ?? null;
      if (!includeMessage) return { userNumber };
      if (userNumber === null) return { userNumber, message: null };
      const notice = await client.from("user_notices").select("message").eq("user_no", userNumber).maybeSingle();
      if (notice.error) throw new Error("lookup_failed");
      return { userNumber, message: notice.data?.message ?? null };
    })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("lookup_timeout")), timeoutMs); })
    ]);
    return reply(200, result);
  } catch { return reply(503, { code: "notices_unavailable" }); }
  finally { clearTimeout(timer); }
}
