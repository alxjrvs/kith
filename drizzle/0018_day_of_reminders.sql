-- A running campaign's sessions are now reminded on the day, in the campaign's
-- own channel (src/attendance/day-of.ts), and asked nothing before it. The
-- reminder ladder and the day-out jeopardy check already armed for campaign
-- sessions would otherwise DM people, or mark a session short, before anybody
-- has been asked. They are stood down here; the hourly tick arms the day-of
-- reminder for every upcoming session (healDayOf in src/campaigns/materialise.ts).
-- Data only: no schema changes. Game days keep their ladder and their check.
UPDATE `jobs`
SET `state` = 'cancelled'
WHERE `kind` IN ('reminder.step', 'jeopardy.check')
  AND `state` IN ('pending', 'failed')
  AND json_extract(`payload`, '$.sessionId') IN (
    SELECT `id` FROM `sessions` WHERE `kind` = 'campaign_session' AND `game_day_id` IS NULL
  );
