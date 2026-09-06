DROP INDEX "recipes_visibility_updated_idx";--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "tags_cache" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "total_time_minutes" integer;--> statement-breakpoint
CREATE INDEX "recipes_tags_idx" ON "recipes" USING gin ("tags_cache");--> statement-breakpoint
CREATE INDEX "recipes_visibility_updated_idx" ON "recipes" USING btree ("visibility","updated_at","id");