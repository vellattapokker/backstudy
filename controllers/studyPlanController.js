const prisma = require('../db');

const generateStudyPlan = async (req, res) => {
    try {
        const userId = req.userId;

        // Fetch user preferences
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const availableHours = user.dailyStudyGoal || 4.0;

        // Fetch active subjects with exams and topics
        const subjects = await prisma.subject.findMany({
            where: { userId },
            include: {
                exams: { orderBy: { date: 'asc' } },
                topics: { where: { isCompleted: false } }
            }
        });

        if (!subjects || subjects.length === 0) {
            return res.status(400).json({ message: "No subjects found to generate a plan." });
        }

        // --- Simple AI/Logic Algorithm ---
        // 1. Calculate weights based on priority (High=3, Medium=2, Low=1) and exam proximity.
        const today = new Date();
        const plan = [];

        let totalWeight = 0;
        subjects.forEach(sub => {
            let weight = 4 - sub.priority; // Priority 1 (High) -> weight 3. Priority 3 (Low) -> weight 1

            // Boost weight if exam is within 14 days
            if (sub.exams && sub.exams.length > 0) {
                const nextExam = sub.exams[0].date;
                const daysUntilExam = Math.ceil((nextExam - today) / (1000 * 60 * 60 * 24));

                if (daysUntilExam > 0 && daysUntilExam <= 14) {
                    weight += (14 - daysUntilExam) * 0.5; // Up to +7 weight for immediate exams
                }
            }
            sub.calculatedWeight = weight;
            totalWeight += weight;
        });

        // 2. Distribute daily available hours
        subjects.forEach(sub => {
            const allocatedHours = (sub.calculatedWeight / totalWeight) * availableHours;

            // Only include subjects that get at least 30 minutes (0.5 hrs)
            if (allocatedHours >= 0.5) {
                // Pick a topic to focus on
                const focusTopic = sub.topics.length > 0 ? sub.topics[0].name : "General Review";

                plan.push({
                    subjectId: sub.id,
                    subjectName: sub.name,
                    allocatedHours: parseFloat(allocatedHours.toFixed(1)),
                    focusTopic: focusTopic
                });
            }
        });

        // Sort plan by allocated time (descending)
        plan.sort((a, b) => b.allocatedHours - a.allocatedHours);

        res.json({
            dailyTotalHours: availableHours,
            schedule: plan
        });

    } catch (error) {
        console.error("Plan Generation Error:", error);
        res.status(500).json({ message: "Internal server error during plan generation." });
    }
};

module.exports = { generateStudyPlan };
