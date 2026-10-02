import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { createTelemetryHandler } from "./handler.mjs";

Deno.serve(createTelemetryHandler({ createClient, getEnv: name => Deno.env.get(name) }));
