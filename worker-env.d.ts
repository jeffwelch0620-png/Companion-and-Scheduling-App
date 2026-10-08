/// <reference types="@cloudflare/workers-types" />
declare namespace Cloudflare { interface Env { DB?: D1Database; SUPABASE_URL?:string; SUPABASE_SERVICE_ROLE_KEY?:string; SUPABASE_SECRET_KEY?:string } }
declare namespace Cloudflare { interface Env { FOOD_ADVISOR_SOURCE_URL?:string; FOOD_ADVISOR_SOURCE_TOKEN?:string; FOOD_ADVISOR_RESTAURANT_BINDINGS?:string } }
