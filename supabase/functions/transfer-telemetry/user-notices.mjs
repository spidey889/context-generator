// Read-only lookup behind the existing private relay authentication. Notice
// checks neither allocate a user nor change counters/transfer diagnostics.
export async function lookupNoticeUser(input, { createClient, getEnv, timeoutMs }, headers) {
  const reply = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
  if (Object.keys(input).length !== 2 || typeof input.install_id !== "string"
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
    const { data, error } = await Promise.race([
      client.from("users").select("user_no").eq("install_id", input.install_id).maybeSingle(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("lookup_timeout")), timeoutMs); })
    ]);
    if (error || (data && (!Number.isSafeInteger(data.user_no) || data.user_no < 1))) throw new Error("lookup_failed");
    return reply(200, { userNumber: data?.user_no ?? null });
  } catch { return reply(503, { code: "notices_unavailable" }); }
  finally { clearTimeout(timer); }
}
