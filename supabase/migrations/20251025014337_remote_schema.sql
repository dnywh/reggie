


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cleanup_expired_tokens"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM preference_tokens 
  WHERE expires_at < NOW() OR (used = TRUE AND used_at < NOW() - INTERVAL '7 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_tokens"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "last_message_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."conversations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."conversations_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."conversations_id_seq" OWNED BY "public"."conversations"."id";



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "direction" "text",
    "subject" "text",
    "body" "text",
    "processed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "messages_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"])))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."messages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."messages_id_seq" OWNED BY "public"."messages"."id";



CREATE TABLE IF NOT EXISTS "public"."pending_replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sent" boolean DEFAULT false,
    "message_id" bigint
);


ALTER TABLE "public"."pending_replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."preference_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action" character varying(20) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval),
    "used" boolean DEFAULT false,
    "used_at" timestamp with time zone,
    CONSTRAINT "preference_tokens_action_check" CHECK ((("action")::"text" = ANY ((ARRAY['pause'::character varying, 'resume'::character varying, 'disconnect'::character varying, 'data_request'::character varying])::"text"[])))
);


ALTER TABLE "public"."preference_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "type" "text",
    "content" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reports_type_check" CHECK (("type" = ANY (ARRAY['daily'::"text", 'weekly'::"text"])))
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."reports_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."reports_id_seq" OWNED BY "public"."reports"."id";



CREATE TABLE IF NOT EXISTS "public"."runs" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "strava_id" bigint,
    "distance_km" numeric(6,2),
    "duration_min" numeric(6,2),
    "avg_pace_min_km" numeric(5,2),
    "rpe" smallint,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "start_date_local" timestamp without time zone,
    "timezone" "text",
    CONSTRAINT "runs_rpe_check" CHECK ((("rpe" >= 1) AND ("rpe" <= 10)))
);


ALTER TABLE "public"."runs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."runs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."runs_id_seq" OWNED BY "public"."runs"."id";



CREATE TABLE IF NOT EXISTS "public"."strava_webhook_subscription" (
    "id" integer DEFAULT 1 NOT NULL,
    "subscription_id" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "single_subscription" CHECK (("id" = 1))
);


ALTER TABLE "public"."strava_webhook_subscription" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_plan" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "day" "date" NOT NULL,
    "type" "text",
    "target_distance_km" numeric(5,2),
    "target_pace_min_km" numeric(5,2),
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "training_plan_type_check" CHECK (("type" = ANY (ARRAY['easy'::"text", 'long'::"text", 'tempo'::"text", 'interval'::"text", 'rest'::"text"])))
);


ALTER TABLE "public"."training_plan" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."training_plan_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."training_plan_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."training_plan_id_seq" OWNED BY "public"."training_plan"."id";



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text",
    "timezone" "text" DEFAULT 'Australia/Sydney'::"text",
    "strava_access_token" "text",
    "strava_refresh_token" "text",
    "strava_token_expires_at" timestamp with time zone,
    "goal_event_date" "date",
    "goal_description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean,
    "temp_training_plan" "text"
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."conversations" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."conversations_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."messages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."messages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."reports_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."runs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."runs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."training_plan" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."training_plan_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_replies"
    ADD CONSTRAINT "pending_replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preference_tokens"
    ADD CONSTRAINT "preference_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preference_tokens"
    ADD CONSTRAINT "preference_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."runs"
    ADD CONSTRAINT "runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."runs"
    ADD CONSTRAINT "runs_strava_id_key" UNIQUE ("strava_id");



ALTER TABLE ONLY "public"."strava_webhook_subscription"
    ADD CONSTRAINT "strava_webhook_subscription_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_plan"
    ADD CONSTRAINT "training_plan_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "conversations_user_id_idx" ON "public"."conversations" USING "btree" ("user_id");



CREATE INDEX "idx_preference_tokens_expires_at" ON "public"."preference_tokens" USING "btree" ("expires_at");



CREATE INDEX "idx_preference_tokens_token" ON "public"."preference_tokens" USING "btree" ("token");



CREATE INDEX "idx_preference_tokens_user_id" ON "public"."preference_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_strava_webhook_subscription_id" ON "public"."strava_webhook_subscription" USING "btree" ("id");



CREATE INDEX "messages_user_created_idx" ON "public"."messages" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "reports_user_created_idx" ON "public"."reports" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "training_plan_user_day_idx" ON "public"."training_plan" USING "btree" ("user_id", "day");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_replies"
    ADD CONSTRAINT "pending_replies_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id");



ALTER TABLE ONLY "public"."preference_tokens"
    ADD CONSTRAINT "preference_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."runs"
    ADD CONSTRAINT "runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_plan"
    ADD CONSTRAINT "training_plan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Service role can manage webhook subscriptions" ON "public"."strava_webhook_subscription" TO "service_role" USING (true);



CREATE POLICY "Users can manage own plans" ON "public"."training_plan" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own runs" ON "public"."runs" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own data" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own messages" ON "public"."messages" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own reports" ON "public"."reports" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pending_replies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."preference_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."strava_webhook_subscription" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_plan" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































GRANT ALL ON FUNCTION "public"."cleanup_expired_tokens"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_tokens"() TO "service_role";
























GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."conversations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."conversations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."conversations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pending_replies" TO "anon";
GRANT ALL ON TABLE "public"."pending_replies" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_replies" TO "service_role";



GRANT ALL ON TABLE "public"."preference_tokens" TO "anon";
GRANT ALL ON TABLE "public"."preference_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."preference_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."runs" TO "anon";
GRANT ALL ON TABLE "public"."runs" TO "authenticated";
GRANT ALL ON TABLE "public"."runs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."strava_webhook_subscription" TO "anon";
GRANT ALL ON TABLE "public"."strava_webhook_subscription" TO "authenticated";
GRANT ALL ON TABLE "public"."strava_webhook_subscription" TO "service_role";



GRANT ALL ON TABLE "public"."training_plan" TO "anon";
GRANT ALL ON TABLE "public"."training_plan" TO "authenticated";
GRANT ALL ON TABLE "public"."training_plan" TO "service_role";



GRANT ALL ON SEQUENCE "public"."training_plan_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."training_plan_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."training_plan_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































RESET ALL;

