-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(150) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(50) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `userType` ENUM('STAFF', 'LEARNER', 'ADMIN') NOT NULL,
    `status` ENUM('UNACTIVATED', 'ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'UNACTIVATED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
