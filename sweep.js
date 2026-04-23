const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();

        console.log('--- GLOBAL TOPIC SWEEP ---');
        const res = await client.query('SELECT t.id, t.name, t."subjectId", s."userId", s.name as sname FROM "Topic" t JOIN "Subject" s ON t."subjectId" = s.id');
        console.log(`Found ${res.rows.length} topics in total.`);
        res.rows.forEach(r => {
            console.log(`- Topic ${r.id}: "${r.name}" (Subject ${r.subjectId} "${r.sname}", User ${r.userId})`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
