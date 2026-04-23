const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();
        const res = await client.query('SELECT count(*) FROM "Topic"');
        console.log('Topic Count:', res.rows[0].count);

        const subRes = await client.query('SELECT count(*) FROM "Subject"');
        console.log('Subject Count:', subRes.rows[0].count);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
