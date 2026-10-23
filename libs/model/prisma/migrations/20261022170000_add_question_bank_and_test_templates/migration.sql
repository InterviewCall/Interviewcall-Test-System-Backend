-- CreateTable
CREATE TABLE `topics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `topics_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `type` ENUM('MCQ', 'SURVEY') NOT NULL DEFAULT 'MCQ',
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `created_by_id` INTEGER NULL,
    `legacy_id` VARCHAR(24) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `questions_legacy_id_key`(`legacy_id`),
    INDEX `questions_topic_id_status_idx`(`topic_id`, `status`),
    INDEX `questions_status_deleted_at_idx`(`status`, `deleted_at`),
    INDEX `questions_created_by_id_fkey`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `statement_md` MEDIUMTEXT NOT NULL,
    `code_stubs` JSON NULL,
    `marks` INTEGER NOT NULL DEFAULT 1,
    `explanation_md` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `question_versions_question_id_version_key`(`question_id`, `version`),
    INDEX `question_versions_created_by_id_fkey`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_options` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_version_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `text_md` TEXT NOT NULL,
    `is_correct` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `question_options_question_version_id_position_key`(`question_version_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `test_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `level` ENUM('INTERMEDIATE', 'ADVANCED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `test_templates_code_key`(`code`),
    INDEX `test_templates_level_idx`(`level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `template_id` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `duration_minutes` INTEGER NOT NULL,
    `pass_percent` INTEGER NOT NULL DEFAULT 50,
    `instructions_md` TEXT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `template_versions_template_id_status_idx`(`template_id`, `status`),
    UNIQUE INDEX `template_versions_template_id_version_key`(`template_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `template_version_id` INTEGER NOT NULL,
    `topic_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `scored` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `template_sections_template_version_id_position_key`(`template_version_id`, `position`),
    UNIQUE INDEX `template_sections_template_version_id_topic_id_key`(`template_version_id`, `topic_id`),
    INDEX `template_sections_topic_id_fkey`(`topic_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `section_id` INTEGER NOT NULL,
    `question_version_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,

    INDEX `template_questions_question_version_id_idx`(`question_version_id`),
    UNIQUE INDEX `template_questions_section_id_position_key`(`section_id`, `position`),
    UNIQUE INDEX `template_questions_section_id_question_version_id_key`(`section_id`, `question_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `questions` ADD CONSTRAINT `questions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_versions` ADD CONSTRAINT `question_versions_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_versions` ADD CONSTRAINT `question_versions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_options` ADD CONSTRAINT `question_options_question_version_id_fkey` FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_versions` ADD CONSTRAINT `template_versions_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `test_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_sections` ADD CONSTRAINT `template_sections_template_version_id_fkey` FOREIGN KEY (`template_version_id`) REFERENCES `template_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_sections` ADD CONSTRAINT `template_sections_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_questions` ADD CONSTRAINT `template_questions_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `template_sections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `template_questions` ADD CONSTRAINT `template_questions_question_version_id_fkey` FOREIGN KEY (`question_version_id`) REFERENCES `question_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
