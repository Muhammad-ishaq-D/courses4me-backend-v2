/**
 * Course reference.
 *
 * The admin course table shows a 6-character reference (e.g. 0E1531), which
 * used to be the tail of the old 24-hex record id. Imported courses keep that
 * exact value (from legacy_id); every other course gets a random one.
 */
const crypto = require('crypto');

const randomReference = () => crypto.randomBytes(3).toString('hex').toUpperCase();

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('courses', 'reference'))) {
    await knex.raw('ALTER TABLE courses ADD COLUMN reference CHAR(6) NULL AFTER id');
  }

  const rows = await knex('courses').select('id', 'legacy_id').whereNull('reference');
  const taken = new Set((await knex('courses').whereNotNull('reference').pluck('reference')));
  for (const row of rows) {
    let ref = row.legacy_id ? row.legacy_id.slice(-6).toUpperCase() : randomReference();
    while (taken.has(ref)) ref = randomReference();
    taken.add(ref);
    await knex('courses').where({ id: row.id }).update({ reference: ref });
  }

  await knex.raw('ALTER TABLE courses MODIFY reference CHAR(6) NOT NULL, ADD UNIQUE KEY uq_courses_reference (reference)');
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE courses DROP INDEX uq_courses_reference, DROP COLUMN reference');
};
