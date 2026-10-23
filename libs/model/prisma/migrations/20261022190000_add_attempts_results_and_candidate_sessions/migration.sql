-- AlterTable
ALTER TABLE `test_schedules` ADD COLUMN `invite_token_hash` CHAR(64) NULL;

-- CreateTable
CREATE TABLE `candidate_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `test_schedule_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `candidate_sessions_token_hash_key`(`token_hash`),
    INDEX `candidate_sessions_test_schedule_id_idx`(`test_schedule_id`),
    INDEX `candidate_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `test_schedule_id` INTEGER NOT NULL,
    `template_version_id` INTEGER NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `submit_reason` ENUM('CANDIDATE', 'TIMEOUT') NULL,
    `work_experience_years` DOUBLE NOT NULL,
    `declared_at` DATETIME(3) NOT NULL,
    `question_order` JSON NOT NULL,
    `last_saved_at` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attempts_test_schedule_id_key`(`test_schedule_id`),
    INDEX `attempts_submitted_at_deadline_at_idx`(`submitted_at`, `deadline_at`),
    INDEX `attempts_template_version_id_idx`(`template_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attempt_answers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `question_version_id` INTEGER NOT NULL,
    `selected_option_id` INTEGER NULL,
    `answered_at` DATETIME(3) NOT NULL,
    `is_correct` BOOLEAN NULL,
    `marks_awarded` INTEGER NULL,

    INDEX `attempt_answers_question_version_id_idx`(`question_version_id`),
    INDEX `attempt_answers_selected_option_id_idx`(`selected_option_id`),
    UNIQUE INDEX `attempt_answers_attempt_id_question_version_id_key`(`attempt_id`, `question_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `results` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `total_marks` INTEGER NOT NULL,
    `obtained_marks` INTEGER NOT NULL,
    `percentage` DECIMAL(5, 2) NOT NULL,
    `passed` BOOLEAN NOT NULL,
    `section_scores` JSON NOT NULL,
    `report_file_key` VARCHAR(255) NULL,
    `report_status` ENUM('PENDING', 'READY', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `report_attempts` INTEGER NOT NULL DEFAULT 0,
    `report_error` VARCHAR(500) NULL,
    `report_ready_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `results_attempt_id_key`(`attempt_id`),
    INDEX `results_report_status_created_at_idx`(`report_status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `feedback_attempt_id_key`(`attempt_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `test_schedules_invite_token_hash_key` ON `test_schedules`(`invite_token_hash`);

-- AddForeignKey
ALTER TABLE `candidate_sessions` ADD CONSTRAINT `candidate_sessions_test_schedule_id_fkey` FOREIGN KEY (`test_schedule_id`) REFERENCES `test_schedules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempts` ADD CONSTRAINT `attempts_test_schedule_id_fkey` FOREIGN KEY (`test_schedule_id`) REFERENCES `test_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempts` ADD CONSTRAINT `attempts_template_version_id_fkey` FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_attempt_id_fkey` FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_question_version_id_fkey` FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attempt_answers` ADD CONSTRAINT `attempt_answers_selected_option_id_fkey` FOREIGN KEY (`selected_option_id`) REFERENCES `question_options`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `results` ADD CONSTRAINT `results_attempt_id_fkey` FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_attempt_id_fkey` FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
