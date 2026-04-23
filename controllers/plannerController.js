const prisma = require('../db');

const generatePlan = async (req, res) => {
    try {
        const { availableHoursPerDay, timezoneOffset } = req.body;
        const userId = req.userId;
        const tzOffset = parseInt(timezoneOffset) || 0;

        // 0. Fetch User and Sync Goal
        const user = await prisma.user.findUnique({ where: { id: userId } });
        let dailyGoal = user?.dailyStudyGoal || 4.0;

        if (availableHoursPerDay) {
            dailyGoal = parseFloat(availableHoursPerDay);
            await prisma.user.update({
                where: { id: userId },
                data: { dailyStudyGoal: dailyGoal }
            });
        }

        // 1. Fetch Subjects and Exams
        const subjects = await prisma.subject.findMany({
            where: { userId: userId },
            include: {
                exams: true,
                topics: { where: { isCompleted: false }, orderBy: { difficulty: 'desc' } }
            },
        });

        if (subjects.length === 0) {
            return res.status(400).json({ message: 'No subjects found. Add subjects first.' });
        }

        console.log(`[Planner] Generating plan for user ${userId}. availableHoursPerDay: ${availableHoursPerDay}, current dailyStudyGoal: ${user?.dailyStudyGoal}, final dailyGoal: ${dailyGoal}`);

        // 2. Calculate Weights
        const now = new Date();

        const subjectWeights = subjects.map(subject => {
            let daysUntilExam = 30; // Default if no exam
            if (subject.exams.length > 0) {
                const earliestExam = new Date(Math.min(...subject.exams.map(e => new Date(e.date))));
                daysUntilExam = Math.max(1, Math.ceil((earliestExam - now) / (1000 * 60 * 60 * 24)));
            }
            const weight = (subject.priority * subject.difficulty) / Math.sqrt(daysUntilExam);
            return { id: subject.id, name: subject.name, weight, topics: subject.topics };
        });

        const totalWeight = subjectWeights.reduce((acc, s) => acc + s.weight, 0);

        // 3. Clear future sessions (Timezone Aware)
        const nowLocal = new Date(now.getTime() + (tzOffset * 60 * 1000));
        nowLocal.setUTCHours(0, 0, 0, 0);
        const startOfTodayUtc = new Date(nowLocal.getTime() - (tzOffset * 60 * 1000));
        const endOfTodayUtc = new Date(startOfTodayUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

        // Fetch work already done TODAY to avoid over-scheduling
        const doneStudySessions = await prisma.studySession.findMany({
            where: {
                subject: { userId: userId },
                isDone: true,
                startTime: { gte: startOfTodayUtc, lte: endOfTodayUtc }
            }
        });
        const donePomodoros = await prisma.pomodoroSession.findMany({
            where: {
                userId: userId,
                completedAt: { gte: startOfTodayUtc, lte: endOfTodayUtc }
            }
        });

        const doneMinsToday = doneStudySessions.reduce((acc, s) => acc + (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60), 0) +
            donePomodoros.reduce((acc, p) => acc + p.durationMinutes, 0);

        const doneHoursToday = doneMinsToday / 60;
        console.log(`[Planner] User ${userId} already did ${doneHoursToday.toFixed(2)}h today.`);

        // 3. Clear sessions (Day 0 onwards)
        // We delete ALL sessions for today onwards to allow a fresh start, 
        // while preserving Pomodoro sessions which are pure recordings.
        const deletePromise = prisma.studySession.deleteMany({
            where: {
                subject: { userId: userId },
                startTime: { gte: startOfTodayUtc },
            },
        });

        // 4. Distribute hours and create sessions for next 7 days
        const sessionsToCreate = [];

        // Calculate start of "today" at 9 AM in user's timezone correctly
        const startOfTodayLocal = new Date(now.getTime() + (tzOffset * 60 * 1000));
        startOfTodayLocal.setUTCHours(9, 0, 0, 0); // Target 9 AM local (treated as UTC here)
        // Convert that 9 AM local timestamp back to true UTC
        const firstSessionStartUtc = new Date(startOfTodayLocal.getTime() - (tzOffset * 60 * 1000));

        for (let day = 0; day < 7; day++) {
            let currentStartTimeUtc = new Date(firstSessionStartUtc);
            currentStartTimeUtc.setUTCDate(currentStartTimeUtc.getUTCDate() + day);

            // For Today (day 0), only schedule the REMAINING hours
            const dailyTargetHours = day === 0
                ? Math.max(0, dailyGoal - doneHoursToday)
                : dailyGoal;

            if (dailyTargetHours <= 0 && day === 0) {
                console.log(`[Planner] Goal already met for today. Skipping today's scheduling.`);
                continue;
            }

            subjectWeights.forEach((sw, index) => {
                const hoursForThisSubject = (sw.weight / totalWeight) * dailyTargetHours;
                if (hoursForThisSubject < 0.5) return; // Skip if less than 30 mins

                const startTimeUtc = new Date(currentStartTimeUtc);
                const endTimeUtc = new Date(startTimeUtc.getTime() + Math.round(hoursForThisSubject * 60 * 60 * 1000));

                // Only schedule if it's in the future
                if (startTimeUtc > now) {
                    // Pick a topic for this session (Syllabus Progress Fix)
                    // If no topics exist, use the subject name as a default focus topic
                    const focusTopic = sw.topics.length > 0
                        ? sw.topics[day % sw.topics.length].name
                        : sw.name;

                    sessionsToCreate.push({
                        subjectId: sw.id,
                        startTime: startTimeUtc,
                        endTime: endTimeUtc,
                        focusTopic: focusTopic
                    });
                }

                // Add 15 min break
                currentStartTimeUtc = new Date(endTimeUtc.getTime() + (15 * 60 * 1000));
            });
        }

        // 5. Execute as a transaction
        const result = await prisma.$transaction(async (tx) => {
            await deletePromise;
            const created = [];
            for (const data of sessionsToCreate) {
                const s = await tx.studySession.create({ data });
                created.push(s);
            }
            return created;
        });

        console.log(`Planner: Regraphed ${result.length} future sessions for user ${userId}`);
        res.json({ message: 'Study plan generated successfully', sessions: result });

    } catch (error) {
        console.error('generatePlan error:', error);
        res.status(500).json({ message: error.message });
    }
};

const getPlan = async (req, res) => {
    try {
        const { timezoneOffset } = req.query;
        const tzOffset = parseInt(timezoneOffset) || 0;

        const now = new Date();

        // 1. Correctly find the start of THE USER'S TODAY in UTC
        const nowLocal = new Date(now.getTime() + (tzOffset * 60 * 1000));
        nowLocal.setUTCHours(0, 0, 0, 0);
        const startOfTodayUtc = new Date(nowLocal.getTime() - (tzOffset * 60 * 1000));

        const endRangeUtc = new Date(startOfTodayUtc);
        endRangeUtc.setUTCDate(endRangeUtc.getUTCDate() + 30); // Show up to 30 days
        endRangeUtc.setMilliseconds(-1);

        const sessions = await prisma.studySession.findMany({
            where: {
                subject: { userId: req.userId },
                startTime: { gte: startOfTodayUtc, lte: endRangeUtc },
            },
            include: { subject: { select: { name: true } } },
            orderBy: { startTime: 'asc' },
        });

        res.json(sessions);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const toggleSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await prisma.studySession.findUnique({
            where: { id: parseInt(id) },
            include: { subject: { select: { userId: true } } },
        });

        if (!session || session.subject.userId !== req.userId) {
            return res.status(404).json({ message: 'Study session not found' });
        }

        const updatedSession = await prisma.studySession.update({
            where: { id: parseInt(id) },
            data: { isDone: !session.isDone },
        });

        // Topic Sync: If session is newly marked as done, try to mark the corresponding Topic as completed
        if (!session.isDone && updatedSession.isDone && session.focusTopic) {
            try {
                // Remove difficulty info for a cleaner match
                const cleanTopicName = session.focusTopic.split('(')[0].trim();

                // 1. Try to update existing topics
                const updateResult = await prisma.topic.updateMany({
                    where: {
                        subject: { userId: req.userId },
                        name: { contains: cleanTopicName, mode: 'insensitive' }
                    },
                    data: { isCompleted: true }
                });

                // 2. If no topic was updated, create a new one for this subject
                if (updateResult.count === 0) {
                    await prisma.topic.create({
                        data: {
                            name: cleanTopicName,
                            isCompleted: true,
                            subjectId: session.subjectId
                        }
                    });
                }
            } catch (err) {
                console.error("Topic Sync Error:", err);
            }
        }

        res.json(updatedSession);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { generatePlan, getPlan, toggleSession };
