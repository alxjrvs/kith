CREATE TABLE `stop_signs` (
	`id` text PRIMARY KEY NOT NULL,
	`game_kind` text NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text,
	`discord_message_id` text,
	`emailed_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stop_signs_game_idx` ON `stop_signs` (`game_kind`,`game_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`game_kind` text NOT NULL,
	`game_id` text NOT NULL,
	`author_user_id` text,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `suggestions_game_idx` ON `suggestions` (`game_kind`,`game_id`,`created_at`);