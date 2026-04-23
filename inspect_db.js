const { Client } = require('pg');

async function main() {
    const client = new Client({
        connectionString: "postgresql://postgres.rcfnyuooseadeqmunrqm:cmKwjnlD1geT96o5@aws-1-ap-south-1.pooler.supabase.com:6543/postgres"
    });

    try {
        await client.connect();

        const userId = 1; // Adithyan
        const tzOffset = 330; // IST

        const now = new Date();
        const nowLocal = new Date(now.getTime() + (tzOffset * 60 * 1000));
        nowLocal.setHours(0, 0, 0, 0);
        const startOfTodayUtc = new Date(nowLocal.getTime() - (tzOffset * 60 * 1000));
        const endOfTodayUtc = new Date(startOfTodayUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

        console.log('User ID:', userId);
        console.log('Today Window (UTC):', startOfTodayUtc.toISOString(), 'to', endOfTodayUtc.toISOString());

        // 1. Pomodoros
        const pomRes = await client.query(
            'SELECT * FROM "PomodoroSession" WHERE "userId" = $1 AND "completedAt" >= $2 AND "completedAt" <= $3',
            [userId, startOfTodayUtc, endOfTodayUtc]
        );
        const pomMins = pomRes.rows.reduce((acc, r) => acc + (r.durationMinutes || 0), 0);
        console.log('Today Poms:', pomRes.rows.length, 'Total Mins:', pomMins);

        // 2. All Daily Study Sessions
        const sessionRes = await client.query(
            'SELECT s.* FROM "StudySession" s JOIN "Subject" sub ON s."subjectId" = sub.id WHERE sub."userId" = $1 AND s."startTime" >= $2 AND s."startTime" <= $3',
            [userId, startOfTodayUtc, endOfTodayUtc]
        );

        const allMins = sessionRes.rows.reduce((acc, s) => {
            return acc + (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60);
        }, 0);
        console.log('Today Total Study Sessions:', sessionRes.rows.length, 'Total Mins:', allMins);

        sessionRes.rows.forEach(s => {
            const mins = (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60);
            console.log(`- Session ${s.id}: ${mins} mins, isDone: ${s.isDone}, start: ${s.startTime.toISOString()}`);
        });

        const doneSessions = sessionRes.rows.filter(s => s.isDone);
        const doneMins = doneSessions.reduce((acc, s) => {
            return acc + (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60);
        }, 0);
        console.log('Today Done Study Mins:', doneMins);

        const totalHoursToday = (pomMins + doneMins) / 60;
        console.log('Result totalHoursToday:', totalHoursToday.toFixed(2));

        const plannedHours = allMins / 60;
        console.log('Result plannedHours (Goal):', plannedHours.toFixed(2));

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

main();
