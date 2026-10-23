-- Tracks whether each candidate invitation email was delivered or bounced.
-- The reference tags the email in SES; SES reports back through the mail-events webhook, which finds the test by it.
ALTER TABLE `test_schedules`
    ADD COLUMN `invitation_mail_ref` VARCHAR(36) NULL,
    ADD COLUMN `invitation_mail_status` ENUM('QUEUED', 'SENT', 'DELAYED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'REJECTED') NULL,
    ADD COLUMN `invitation_mail_detail` VARCHAR(500) NULL,
    ADD COLUMN `invitation_mail_updated_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `test_schedules_invitation_mail_ref_key` ON `test_schedules`(`invitation_mail_ref`);
