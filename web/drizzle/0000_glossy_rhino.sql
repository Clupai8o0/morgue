CREATE TABLE "cli_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "cli_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "waitlist_created_idx" ON "waitlist" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "waitlist_ip_idx" ON "waitlist" USING btree ("ip_hash");