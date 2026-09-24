#!/usr/bin/env node
/**
 * Moves the articles the portal used to carry in its bundle into the database.
 *
 *   node scripts/seed_blogs.js --dry-run
 *   node scripts/seed_blogs.js
 *   node scripts/seed_blogs.js --no-upload      keep the bundled image paths
 *
 * The source is `course4me/src/data/blogs.js`, which is an ES module holding
 * one array and a handful of image imports. It is read as text and evaluated
 * with the imports turned into their file paths, so the seed stays in step
 * with that file without the portal having to export anything new.
 *
 * Each cover is uploaded to Cloudinary once and the article stores the URL;
 * running again finds the article by slug and updates it rather than adding a
 * second copy, and does not re-upload a cover that is already hosted.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const db = require('../src/config/db');
const BlogModel = require('../src/models/blogModel');
const cloudinary = require('../src/config/cloudinary');
const logger = require('../src/utils/logger');

const flag = (name) => process.argv.slice(2).includes(`--${name}`);
function arg(name, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find(a => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const DRY_RUN = flag('dry-run');
const NO_UPLOAD = flag('no-upload');
const SOURCE = path.resolve(process.cwd(), arg('source', path.join('..', 'course4me', 'src', 'data', 'blogs.js')));

/**
 * Reads the portal's article file. The image imports become their resolved
 * paths on disk, so the covers can be uploaded from here.
 */
function readArticles(file) {
  const dir = path.dirname(file);
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

  const covers = {};
  source = source.replace(
    /^import\s+(\w+)\s+from\s+['"](.+?)['"];?\s*$/gm,
    (_match, name, relative) => {
      covers[name] = path.resolve(dir, relative);
      return `const ${name} = ${JSON.stringify(name)};`;
    }
  );
  source = source.replace(/^export\s+const\s+blogsData\s*=/m, 'exports.blogsData =');
  source = source.replace(/^export\s+/gm, '');

  const exported = {};
  vm.runInNewContext(source, { exports: exported, module: { exports: exported }, console });
  const articles = exported.blogsData;
  if (!Array.isArray(articles)) throw new Error(`${file} does not export blogsData as an array`);

  return articles.map(a => ({ ...a, coverFile: covers[a.image] || null }));
}

/** Uploads one cover and returns its URL, or null when it cannot be read. */
async function uploadCover(file, slug) {
  if (!file || !fs.existsSync(file)) return null;
  const upload = await cloudinary.uploader.upload(file, {
    folder: 'courses4me/blogs',
    public_id: slug,
    overwrite: true,
    transformation: [{ width: 1600, height: 900, crop: 'limit' }]
  });
  return upload.secure_url;
}

/** "Feb 28, 2026" -> a Date, so ordering and filtering have something real. */
function parsePublishDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`No article file at ${SOURCE}.`);
    console.error('Pass --source <path> if the portal lives somewhere else.');
    process.exit(1);
  }

  const articles = readArticles(SOURCE);
  console.log(`${articles.length} article(s) in ${path.relative(process.cwd(), SOURCE)}\n`);

  let created = 0;
  let updated = 0;
  let uploaded = 0;
  const problems = [];

  for (const article of articles) {
    const slug = article.slug || BlogModel.slugify(article.title);
    // Keyed on the id the portal file gives each article, not the slug: two
    // of them share a slug, and the database keeps slugs unique.
    const legacyId = `portal-${article.id}`;
    const [match] = await db.query('SELECT id FROM blogs WHERE legacy_id = ? LIMIT 1', [legacyId]);
    const existing = match ? await BlogModel.findOne(match.id) : null;

    let cover = existing ? existing.coverImage : '';
    // Only upload when there is nothing hosted yet, so a re-run is cheap and
    // a cover replaced in the admin is never overwritten by the bundled one.
    if (!NO_UPLOAD && !String(cover).startsWith('http')) {
      try {
        if (!DRY_RUN) {
          cover = await uploadCover(article.coverFile, slug);
          if (cover) uploaded += 1;
        } else {
          cover = `(would upload ${path.basename(article.coverFile || 'nothing')})`;
        }
      } catch (err) {
        problems.push(`${slug}: cover upload failed — ${err.message}`);
        cover = existing ? existing.coverImage : '';
      }
    }

    const payload = {
      slug,
      legacyId,
      title: article.title,
      excerpt: article.excerpt || '',
      category: article.category,
      coverImage: DRY_RUN ? (existing ? existing.coverImage : '') : cover,
      authorName: article.author || '',
      authorRole: article.role || '',
      publishDate: article.publishDate || '',
      readTime: article.readTime || '5 min read',
      // The first article is the one the portal shows as its feature.
      featured: articles.indexOf(article) === 0,
      status: 'Published',
      publishedAt: parsePublishDate(article.publishDate),
      content: article.content || []
    };

    if (DRY_RUN) {
      console.log(`  ${existing ? 'update' : 'create'}  ${slug}  (${(article.content || []).length} blocks)`);
      if (existing) updated += 1; else created += 1;
      continue;
    }

    if (existing) {
      await BlogModel.update(existing.id, payload);
      updated += 1;
      console.log(`  updated  ${slug}`);
    } else {
      await BlogModel.create(payload);
      created += 1;
      console.log(`  created  ${slug}`);
    }
  }

  console.log(`\n${created} created, ${updated} updated, ${uploaded} cover(s) uploaded`);
  if (problems.length) {
    console.log('\nWorth knowing:');
    problems.forEach(p => console.log(`  - ${p}`));
  }
  if (DRY_RUN) console.log('\nDry run — nothing was written.');

  process.exit(0);
}

main().catch((err) => {
  logger.error(`Seeding the articles failed: ${err.message}`);
  console.error(err);
  process.exit(1);
});
