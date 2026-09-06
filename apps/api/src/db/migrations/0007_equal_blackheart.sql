CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"uploader_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "image_cache" text;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_recipe_idx" ON "media" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "media_uploader_idx" ON "media" USING btree ("uploader_id");