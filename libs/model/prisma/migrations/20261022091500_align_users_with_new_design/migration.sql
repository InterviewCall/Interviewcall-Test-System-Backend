-- AlterTable
-- Renames passwordHash -> password_hash and userType -> role, and replaces the
-- STAFF/LEARNER/ADMIN values with ADMIN/ADVISOR/EDITOR. Candidates are not users
-- in the new design, so LEARNER is gone. CHANGE keeps existing data; the ALTER
-- fails (instead of silently truncating) if any row still holds STAFF or LEARNER.
ALTER TABLE `users`
    CHANGE `passwordHash` `password_hash` VARCHAR(191) NOT NULL,
    CHANGE `userType` `role` ENUM('ADMIN', 'ADVISOR', 'EDITOR') NOT NULL;
