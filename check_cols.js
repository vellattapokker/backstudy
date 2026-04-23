const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'PomodoroSession'
        `);
        console.log('Columns in PomodoroSession:', res.rows.map(r => r.column_name));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
