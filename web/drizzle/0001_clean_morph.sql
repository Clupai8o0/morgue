CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jti" text NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text NOT NULL,
	"slug" text,
	"label" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "share_links_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
CREATE INDEX "share_links_created_idx" ON "share_links" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "share_links_expires_idx" ON "share_links" USING btree ("expires_at");