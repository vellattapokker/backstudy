const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();
        const res = await client.query('SELECT s.id as sid, s.name as sname, t.id as tid, t.name as tname, t."isCompleted" FROM "Subject" s LEFT JOIN "Topic" t ON s.id = t."subjectId" WHERE s."userId" = 1');

        const subjects = {};
        res.rows.forEach(r => {
            if (!subjects[r.sid]) subjects[r.sid] = { name: r.sname, topics: [] };
            if (r.tid) subjects[r.sid].topics.push({ id: r.tid, name: r.tname, done: r.isCompleted });
        });

        Object.keys(subjects).forEach(sid => {
            const s = subjects[sid];
            console.log(`Subject ${sid}: "${s.name}" - ${s.topics.length} topics`);
            s.topics.forEach(t => console.log(`  - Topic ${t.id}: "${t.name}" [${t.done ? 'DONE' : 'TODO'}]`));
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
