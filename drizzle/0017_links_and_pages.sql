CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`visibility` text DEFAULT 'members' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "links_target_ck" CHECK("links"."target_type" IN ('campaign', 'game_day'))
);
--> statement-breakpoint
CREATE INDEX `links_target_idx` ON `links` (`target_type`,`target_id`,`position`);--> statement-breakpoint
CREATE TABLE `pages` (
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'members' NOT NULL,
	`updated_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`target_type`, `target_id`, `slug`),
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pages_target_ck" CHECK("pages"."target_type" IN ('campaign', 'game_day'))
);
