ALTER TABLE `campaigns` ADD `visibility` text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `tagline` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `pitch` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `hero_url` text;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `sound_url` text;--> statement-breakpoint
ALTER TABLE `game_days` ADD `visibility` text DEFAULT 'members' NOT NULL;--> statement-breakpoint
ALTER TABLE `game_days` ADD `tagline` text;--> statement-breakpoint
ALTER TABLE `game_days` ADD `pitch` text;--> statement-breakpoint
ALTER TABLE `game_days` ADD `hero_url` text;--> statement-breakpoint
ALTER TABLE `game_days` ADD `sound_url` text;--> statement-breakpoint
ALTER TABLE `games` ADD `category` text DEFAULT 'ttrpg' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `games` ADD `cover_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar` text;