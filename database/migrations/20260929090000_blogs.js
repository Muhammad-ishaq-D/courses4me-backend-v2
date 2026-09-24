/**
 * Articles for the blog, and the blocks their body is built from.
 *
 * The body is a list of typed blocks (a paragraph, a heading, a bullet list)
 * rather than one lump of HTML, because that is the shape the article page
 * already renders and the shape the editor writes. A block is one row, kept
 * in order by `position`; list blocks hold their items in `blog_block_items`.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('blogs', (table) => {
    table.increments('id').unsigned().primary();
    table.string('slug', 200).notNullable();
    table.string('title', 255).notNullable();
    table.text('excerpt').notNullable().defaultTo('');
    table.enu('category', ['Career Guide', 'Industry News', 'Study Tips', 'Company News', 'Training', 'Technology'], {
      useNative: false,
      enumName: null
    }).notNullable().defaultTo('Career Guide');
    table.string('cover_image', 500).nullable();
    table.string('author_name', 150).notNullable().defaultTo('');
    table.string('author_role', 150).notNullable().defaultTo('');
    table.string('author_avatar', 500).nullable();
    // The date as the article displays it ("Feb 28, 2026"); `published_at`
    // is what ordering and filtering use.
    table.string('publish_date', 60).notNullable().defaultTo('');
    table.string('read_time', 40).notNullable().defaultTo('5 min read');
    table.boolean('featured').notNullable().defaultTo(false);
    table.enu('status', ['Published', 'Draft', 'Archived']).notNullable().defaultTo('Draft');
    table.datetime('published_at').nullable();
    table.integer('views').unsigned().notNullable().defaultTo(0);
    table.specificType('legacy_id', 'CHAR(24)').nullable();
    table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.unique(['slug'], { indexName: 'uq_blogs_slug' });
    table.unique(['legacy_id'], { indexName: 'uq_blogs_legacy_id' });
    table.index(['status', 'published_at'], 'ix_blogs_status_published');
    table.index(['category'], 'ix_blogs_category');
  });

  await knex.raw('ALTER TABLE blogs ADD FULLTEXT INDEX ft_blogs_search (title, excerpt)');

  await knex.schema.createTable('blog_blocks', (table) => {
    table.increments('id').unsigned().primary();
    table.integer('blog_id').unsigned().notNullable();
    table.integer('position').unsigned().notNullable().defaultTo(0);
    table.enu('type', ['paragraph', 'heading', 'subheading', 'list', 'numberedList', 'quote', 'image']).notNullable();
    table.text('text').nullable();

    table.foreign('blog_id', 'fk_blog_blocks_blog').references('id').inTable('blogs').onDelete('CASCADE');
    table.index(['blog_id', 'position'], 'ix_blog_blocks_order');
  });

  await knex.schema.createTable('blog_block_items', (table) => {
    table.increments('id').unsigned().primary();
    table.integer('blog_block_id').unsigned().notNullable();
    table.integer('position').unsigned().notNullable().defaultTo(0);
    table.string('value', 1000).notNullable();

    table.foreign('blog_block_id', 'fk_blog_block_items_block').references('id').inTable('blog_blocks').onDelete('CASCADE');
    table.index(['blog_block_id', 'position'], 'ix_blog_block_items_order');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('blog_block_items');
  await knex.schema.dropTableIfExists('blog_blocks');
  await knex.schema.dropTableIfExists('blogs');
};
