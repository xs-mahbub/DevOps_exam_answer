const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/notes_db'
});

async function seed() {
  console.log('Seeding Database...');
  await pool.query(`
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS notes;
    DROP TABLE IF EXISTS tenants;

    CREATE TABLE tenants (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL
    );

    CREATE TABLE notes (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL REFERENCES tenants(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );

    CREATE TABLE tags (
      id SERIAL PRIMARY KEY,
      note_id INT NOT NULL REFERENCES notes(id),
      name TEXT NOT NULL
    );
  `);

  await pool.query(`
    INSERT INTO tenants (slug) VALUES ('acme'), ('globex'), ('soylent'), ('initech'), ('umbrella');
  `);

  console.log('Inserting 50,000 notes with skewed tenant distribution...');
  await pool.query(`
    INSERT INTO notes (tenant_id, title, body)
    SELECT 
      CASE WHEN g <= 30000 THEN 1 ELSE ((g % 4) + 2) END,
      'Note ' || g,
      md5(random()::text) || ' ' || md5(random()::text)
    FROM generate_series(1, 50000) g;
  `);

  console.log('Inserting 150,000 tags...');
  await pool.query(`
    INSERT INTO tags (note_id, name)
    SELECT (random() * 49999 + 1)::int, 'tag-' || (random() * 100)::int
    FROM generate_series(1, 150000) g;
  `);

  console.log('Database Seeding Complete!');
  await pool.end();
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
