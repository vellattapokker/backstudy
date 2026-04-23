const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();
        console.log('Adding column durationMinutes to PomodoroSession...');
        // First, check if it's there
        const checkRes = await client.query("SELECT * FROM information_schema.columns WHERE table_name = 'PomodoroSession' AND column_name = 'durationMinutes'");

        if (checkRes.rows.length === 0) {
            await client.query('ALTER TABLE "PomodoroSession" ADD COLUMN "durationMinutes" INTEGER DEFAULT 25');
            console.log('Column added successfully.');
        } else {
            console.log('Column already exists.');
        }

        const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'PomodoroSession'");
        console.log('Current columns:', res.rows.map(r => r.column_name));
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
