-- A candidate may now have any number of tests, so candidate_id stops being unique.
-- The foreign key needs an index at all times, so the plain index is added in the same statement that drops the unique one.
ALTER TABLE `test_schedules`
    ADD INDEX `test_schedules_candidate_id_idx`(`candidate_id`),
    DROP INDEX `test_schedules_candidate_id_key`;
