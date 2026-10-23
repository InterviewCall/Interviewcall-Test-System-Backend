-- Adds the Manager role: sees every advisor's tests and the staff list, but cannot manage staff.
-- Appended last so existing rows keep their values and the change needs no table rebuild.
ALTER TABLE `users` MODIFY `role` ENUM('ADMIN', 'ADVISOR', 'EDITOR', 'MANAGER') NOT NULL;
