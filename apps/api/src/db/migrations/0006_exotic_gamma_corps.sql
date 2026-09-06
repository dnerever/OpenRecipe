CREATE TYPE "public"."proposal_state" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"target_recipe_id" uuid NOT NULL,
	"source_recipe_id" uuid NOT NULL,
	"base_version_id" uuid NOT NULL,
	"head_version_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" "proposal_state" DEFAULT 'open' NOT NULL,
	"merged_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_target_recipe_id_recipes_id_fk" FOREIGN KEY ("target_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_source_recipe_id_recipes_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_base_version_id_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_head_version_id_versions_id_fk" FOREIGN KEY ("head_version_id") REFERENCES "public"."versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_merged_version_id_versions_id_fk" FOREIGN KEY ("merged_version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_proposal_created_idx" ON "comments" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_target_number_idx" ON "proposals" USING btree ("target_recipe_id","number");--> statement-breakpoint
CREATE INDEX "proposals_target_state_idx" ON "proposals" USING btree ("target_recipe_id","state","created_at");--> statement-breakpoint
CREATE INDEX "proposals_source_idx" ON "proposals" USING btree ("source_recipe_id");--> statement-breakpoint
CREATE INDEX "proposals_author_idx" ON "proposals" USING btree ("author_id");