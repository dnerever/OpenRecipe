CREATE TABLE "stars" (
	"user_id" text NOT NULL,
	"recipe_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stars_user_id_recipe_id_pk" PRIMARY KEY("user_id","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title_cache, '')), 'A') || setweight(array_to_tsvector(tags_cache), 'B') || setweight(to_tsvector('english', coalesce(description_cache, '')), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stars_user_created_idx" ON "stars" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "recipes_search_idx" ON "recipes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "recipes_popular_idx" ON "recipes" USING btree ("visibility","star_count","fork_count","id");