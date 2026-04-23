const prisma = require('../db');

// Removed toggleTopicCompletion (use subjectController.toggleTopicStatus instead)

const getOverallProgress = async (req, res) => {
    try {
        const userId = req.userId;
        const { timezoneOffset } = req.query; // in minutes, e.g. -330 for IST
        const tzOffset = parseInt(timezoneOffset) || 0;

        // 1. Fetch User Goal
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { dailyStudyGoal: true, streak: true }
        });

        // 2. Fetch Subjects and Topics (Syllabus Progress)
        const subjects = await prisma.subject.findMany({
            where: { userId },
            include: { topics: true },
        });

        const totalTopics = subjects.reduce((acc, sub) => acc + sub.topics.length, 0);
        const completedTopics = subjects.reduce(
            (acc, sub) => acc + sub.topics.filter(t => t.isCompleted).length,
            0
        );
        const syllabusPercentage = totalTopics === 0 ? 0 : Math.round((completedTopics / totalTopics) * 100);

        // 3. Correctly find the start of THE USER'S TODAY in UTC
        const now = new Date();
        const nowLocal = new Date(now.getTime() + (tzOffset * 60 * 1000));
        nowLocal.setUTCHours(0, 0, 0, 0);
        const startOfTodayUtc = new Date(nowLocal.getTime() - (tzOffset * 60 * 1000));

        const endOfTodayUtc = new Date(startOfTodayUtc);
        endOfTodayUtc.setUTCDate(endOfTodayUtc.getUTCDate() + 1);
        endOfTodayUtc.setMilliseconds(-1);

        // 4. Fetch Today's Activity
        const dailyPomodoroSessions = await prisma.pomodoroSession.findMany({
            where: {
                userId,
                completedAt: { gte: startOfTodayUtc, lte: endOfTodayUtc }
            }
        });

        const allDailyStudySessions = await prisma.studySession.findMany({
            where: {
                subject: { userId },
                startTime: { gte: startOfTodayUtc, lte: endOfTodayUtc }
            }
        });

        const doneStudySessions = allDailyStudySessions.filter(s => s.isDone);

        // Calculate hours from Pomodoro (minutes) and StudySessions (duration)
        const pomodoroMinutes = dailyPomodoroSessions.reduce((acc, s) => acc + s.durationMinutes, 0);
        const doneStudySessionMinutes = doneStudySessions.reduce((acc, s) => {
            const duration = (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60);
            return acc + duration;
        }, 0);

        const totalMinutesToday = pomodoroMinutes + doneStudySessionMinutes;
        const totalHoursToday = parseFloat((totalMinutesToday / 60).toFixed(2));

        // Calculate goal based on TOTAL planned sessions for today
        const plannedMinutesToday = allDailyStudySessions.reduce((acc, s) => {
            const duration = (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60);
            return acc + duration;
        }, 0);

        const dailyGoal = plannedMinutesToday > 0
            ? parseFloat((plannedMinutesToday / 60).toFixed(2))
            : (user?.dailyStudyGoal || 4.0);

        const dailyProgressPercent = Math.min(100, Math.round((totalHoursToday / dailyGoal) * 100));

        console.log(`[Progress] User ${userId}: Sessions mins: ${doneStudySessionMinutes}, Pom mins: ${pomodoroMinutes}, Total: ${totalHoursToday}h, Goal: ${dailyGoal}`);

        // 5. Weekly Stats
        const oneWeekAgo = new Date(now);
        oneWeekAgo.setUTCDate(oneWeekAgo.getUTCDate() - 7);

        const weeklySessions = await prisma.pomodoroSession.findMany({
            where: {
                userId,
                completedAt: { gte: oneWeekAgo }
            }
        });

        const totalFocusMinutesThisWeek = weeklySessions.reduce((acc, s) => acc + s.durationMinutes, 0);

        res.json({
            totalTopics: totalTopics || 0,
            completedTopics: completedTopics || 0,
            syllabusPercentage: syllabusPercentage || 0,
            totalHoursToday: totalHoursToday || 0,
            dailyGoal: dailyGoal || 4.0,
            dailyProgressPercent: dailyProgressPercent || 0,
            totalFocusMinutesThisWeek: totalFocusMinutesThisWeek || 0,
            streakDays: user?.streak || 0,
            // Deprecated field for compatibility
            percentage: syllabusPercentage || 0,
            debug: {
                pomodoroMinutes,
                doneStudySessionMinutes,
                plannedMinutesToday,
                allDailyStudySessionsCount: allDailyStudySessions.length,
                doneStudySessionsCount: doneStudySessions.length,
                tzOffset,
                startOfTodayUtc: startOfTodayUtc.toISOString(),
                endOfTodayUtc: endOfTodayUtc.toISOString(),
                allSessions: allDailyStudySessions.map(s => ({
                    id: s.id,
                    isDone: s.isDone,
                    mins: (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60)
                }))
            }
        });
    } catch (error) {
        console.error('getOverallProgress Error:', error);
        res.status(500).json({ message: error.message });
    }
};

const logPomodoroSession = async (req, res) => {
    try {
        const userId = req.userId;
        const { durationMinutes } = req.body;

        const session = await prisma.pomodoroSession.create({
            data: {
                userId,
                durationMinutes: durationMinutes || 25
            }
        });

        res.status(201).json(session);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getOverallProgress, logPomodoroSession };
