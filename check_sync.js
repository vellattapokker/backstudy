const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();

        const userId = 1; // Adithyan
        console.log('Inspecting Data for User ID:', userId);

        // 1. Check Topics
        const topicRes = await client.query(
            'SELECT t.id, t.name, t."isCompleted", s.name as "subjectName" FROM "Topic" t JOIN "Subject" s ON t."subjectId" = s.id WHERE s."userId" = $1',
            [userId]
        );
        console.log('Total Topics:', topicRes.rows.length);
        const completed = topicRes.rows.filter(r => r.isCompleted);
        console.log('Completed Topics count:', completed.length);
        if (topicRes.rows.length > 0) {
            console.log('Sample Topic Name:', topicRes.rows[0].name);
        }

        // 2. Check Study Sessions
        const sessionRes = await client.query(
            'SELECT s.id, s."focusTopic", s."isDone" FROM "StudySession" s JOIN "Subject" sub ON s."subjectId" = sub.id WHERE sub."userId" = $1 AND s."isDone" = true',
            [userId]
        );
        console.log('Done Study Sessions count:', sessionRes.rows.length);
        sessionRes.rows.forEach(r => {
            console.log(`- Session ${r.id}: focusTopic="${r.focusTopic}"`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
