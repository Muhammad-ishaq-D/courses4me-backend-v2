/**
 * Columns the imported records need.
 *
 * Thumbnails, instructor portraits and CV files are stored inline as data
 * URIs rather than as links to a file store, so they run to hundreds of
 * kilobytes; `courses` was widened for the same reason when it landed.
 * `notifications` gains the reference column every other top-level table
 * already carries, so an import can be repeated without duplicating rows.
 */
exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE licenses MODIFY thumbnail MEDIUMTEXT NULL');
  await knex.raw('ALTER TABLE licenses MODIFY instructor_photo MEDIUMTEXT NULL');
  await knex.raw('ALTER TABLE job_applications MODIFY cv_file MEDIUMTEXT NOT NULL');

  const hasLegacyId = await knex.schema.hasColumn('notifications', 'legacy_id');
  if (!hasLegacyId) {
    await knex.schema.alterTable('notifications', (table) => {
      table.specificType('legacy_id', 'CHAR(24)').nullable();
      table.unique(['legacy_id'], { indexName: 'uq_notifications_legacy_id' });
    });
  }
};

exports.down = async function down(knex) {
  const hasLegacyId = await knex.schema.hasColumn('notifications', 'legacy_id');
  if (hasLegacyId) {
    await knex.schema.alterTable('notifications', (table) => {
      table.dropUnique(['legacy_id'], 'uq_notifications_legacy_id');
      table.dropColumn('legacy_id');
    });
  }
  await knex.raw("ALTER TABLE job_applications MODIFY cv_file VARCHAR(500) NOT NULL DEFAULT 'cv_resume.pdf'");
  await knex.raw('ALTER TABLE licenses MODIFY instructor_photo VARCHAR(500) NULL');
  await knex.raw('ALTER TABLE licenses MODIFY thumbnail VARCHAR(500) NULL');
};
