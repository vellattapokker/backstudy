const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();
        const res = await client.query('SELECT id, name, email, role FROM "User"');
        console.log('Users:', res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
