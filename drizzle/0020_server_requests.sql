CREATE TABLE `server_requests` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`invite_code` text,
	`invite_expires_at` integer,
	`discord_message_id` text,
	`decided_by` text,
	`decided_at` integer,
	`joined_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
