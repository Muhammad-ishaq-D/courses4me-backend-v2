/**
 * Licence images.
 *
 * The admin panel posts the thumbnail and instructor photo as base64 data
 * URIs, which do not fit in VARCHAR(500). MEDIUMTEXT holds up to 16 MB.
 */
exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE licenses
      MODIFY thumbnail MEDIUMTEXT NULL,
      MODIFY instructor_photo MEDIUMTEXT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE licenses
      MODIFY thumbnail VARCHAR(500) NULL DEFAULT NULL,
      MODIFY instructor_photo VARCHAR(500) NULL DEFAULT NULL
  `);
};
