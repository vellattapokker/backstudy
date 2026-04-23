const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();
        const userId = 1;

        // 1. Get all topics
        const topicsRes = await client.query(
            'SELECT t.id, t.name, t."subjectId" FROM "Topic" t JOIN "Subject" s ON t."subjectId" = s.id WHERE s."userId" = $1',
            [userId]
        );

        // 2. Get all done sessions
        const sessRes = await client.query(
            'SELECT s."focusTopic", s.id FROM "StudySession" s JOIN "Subject" sub ON s."subjectId" = sub.id WHERE sub."userId" = $1 AND s."isDone" = true',
            [userId]
        );

        console.log(`Syncing ${sessRes.rows.length} sessions against ${topicsRes.rows.length} topics...`);

        let updated = 0;
        for (const sess of sessRes.rows) {
            if (!sess.focusTopic) continue;
            const cleanSess = sess.focusTopic.split('(')[0].replace(/\s+/g, '').toLowerCase();

            for (const topic of topicsRes.rows) {
                const cleanTopic = topic.name.split('(')[0].replace(/\s+/g, '').toLowerCase();

                if (cleanTopic === cleanSess || cleanTopic.includes(cleanSess) || cleanSess.includes(cleanTopic)) {
                    const up = await client.query('UPDATE "Topic" SET "isCompleted" = true WHERE id = $1 AND "isCompleted" = false', [topic.id]);
                    updated += up.rowCount;
                    if (up.rowCount > 0) {
                        console.log(`- MATCH: session "${sess.focusTopic}" matched topic "${topic.name}" -> SUCCESS`);
                    }
                }
            }
        }

        console.log(`Total topics retro-synced: ${updated}`);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
