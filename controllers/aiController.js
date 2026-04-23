const Groq = require("groq-sdk");
const prisma = require("../db");

if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY is missing in .env file.");
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "dummy_key",
});

const generateAIStudyPlan = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      dailyStudyHours: requestedHours,
      days: requestedDays,
      subjectIds,
      preferredStartHour,
      timezoneOffset
    } = req.body;

    const studyDays = parseInt(requestedDays) || 7;
    const tzOffset = parseInt(timezoneOffset) || 0; // in minutes

    // 1. Fetch User and Data
    const user = await prisma.user.findUnique({ where: { id: userId } });
    let hoursPerDay = requestedHours || user.dailyStudyGoal || 4.0;

    if (requestedHours) {
      hoursPerDay = parseFloat(requestedHours);
      await prisma.user.update({
        where: { id: userId },
        data: { dailyStudyGoal: hoursPerDay }
      });
    }

    const whereClause = { userId };
    if (subjectIds && Array.isArray(subjectIds) && subjectIds.length > 0) {
      whereClause.id = { in: subjectIds.map(id => parseInt(id)) };
    }

    const subjects = await prisma.subject.findMany({
      where: whereClause,
      include: {
        exams: { orderBy: { date: "asc" } },
        topics: { where: { isCompleted: false } },
      },
    });

    if (!subjects || subjects.length === 0) {
      return res.status(400).json({ message: "Add subjects first to generate a plan." });
    }

    // 2. Calculate User's "Today"
    const nowServer = new Date();
    const nowUser = new Date(nowServer.getTime() + (tzOffset * 60 * 1000));

    // Generate dates based on User's local time
    const upcomingDates = [];
    for (let i = 0; i < studyDays; i++) {
      const d = new Date(nowUser);
      d.setUTCDate(d.getUTCDate() + i);
      upcomingDates.push(d.toISOString().split('T')[0]);
    }

    // Calculate work already done TODAY to adjust the first day's availability
    const todayUserStart = new Date(upcomingDates[0] + 'T00:00:00Z');
    const startRangeUtc = new Date(todayUserStart.getTime() - (tzOffset * 60 * 1000));
    const endRangeTodayUtc = new Date(startRangeUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

    const doneStudySessions = await prisma.studySession.findMany({
      where: {
        subject: { userId },
        isDone: true,
        startTime: { gte: startRangeUtc, lte: endRangeTodayUtc }
      }
    });
    const donePomodoros = await prisma.pomodoroSession.findMany({
      where: {
        userId,
        completedAt: { gte: startRangeUtc, lte: endRangeTodayUtc }
      }
    });

    const doneMinsToday = doneStudySessions.reduce((acc, s) => acc + (new Date(s.endTime) - new Date(s.startTime)) / (1000 * 60), 0) +
      donePomodoros.reduce((acc, p) => acc + p.durationMinutes, 0);
    const doneHoursToday = doneMinsToday / 60;

    // Adjust first day's hours in prompt
    const hoursForTodayPrompt = Math.max(0, hoursPerDay - doneHoursToday);
    console.log(`[AI Planner] User ${userId} already did ${doneHoursToday.toFixed(2)}h. Today's prompt hours: ${hoursForTodayPrompt.toFixed(2)}`);

    const startHour = preferredStartHour || 9;
    const startTimeFormatted = `${startHour}:00 ${startHour >= 12 ? 'PM' : 'AM'}`;

    const subjectsDetails = subjects
      .map((s) => {
        const topicsList = s.topics.map((t) => `${t.name} (Difficulty: ${t.difficulty}/5)`).join(", ");
        return `- ID: ${s.id}, Name: ${s.name}: ${topicsList} (Difficulty: ${s.difficulty}/5, Priority: ${s.priority}/5)`;
      })
      .join("\n");

    const prompt = `You are an AI Study Planner. Create a ${studyDays}-day optimized study schedule.
Available study time for Day 1 (Today): ${hoursForTodayPrompt.toFixed(1)} hours.
Available study time for subsequent days: ${hoursPerDay} hours per day.
User Timezone Offset: ${tzOffset} minutes (GMT${tzOffset <= 0 ? '+' : '-'}${Math.abs(tzOffset / 60)})

Subjects & Topics (Use these IDs):
${subjectsDetails}

Scheduled Dates:
${upcomingDates.map((d, i) => `Day ${i + 1}: ${d}`).join("\n")}

Rules:
1. You MUST start the very first session on ${upcomingDates[0]} at exactly ${startTimeFormatted} LOCAL time.
2. Subsequent sessions for Day 1 must follow after the first session.
3. Output startTime and endTime as 24-hour local time strings (e.g., "09:00", "11:30") relative to the "date" field.
4. Ensure no subject sessions overlap in time on the same day.
5. Maximize productivity by putting harder subjects earlier.
6. Output MUST be a valid JSON object with this exact structure:
{
  "schedule": [
    {
      "date": "2026-03-29",
      "startTime": "09:00",
      "endTime": "11:00",
      "subjectId": 12,
      "focusTopic": "Calculus: Derivatives"
    }
  ]
}
Return ONLY the JSON object.`;

    // 3. Call Groq
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    let aiResponse;
    try {
      const rawContent = completion.choices[0].message.content;
      // Handle cases where AI might wrap JSON in markdown code blocks
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      aiResponse = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", completion.choices[0].message.content);
      throw new Error("AI returned an invalid format. Please try again.");
    }

    const sessions = aiResponse.schedule || aiResponse.sessions || [];

    // 4. Clear old sessions from the start of the user's TODAY (local 00:00)
    // todayUserStart and startRangeUtc are already defined above

    // Safety: Also delete any sessions that might have been created for "today" already
    await prisma.studySession.deleteMany({
      where: {
        subject: { userId },
        startTime: { gte: startRangeUtc },
      },
    });

    // 5. Transform and save sessions
    const createdSessions = [];
    for (const s of sessions) {
      const dbSubject = subjects.find((sub) => sub.id === parseInt(s.subjectId));
      if (dbSubject) {
        // Convert local time string (HH:mm) to UTC Date
        const [startH, startM] = s.startTime.split(':').map(Number);
        const [endH, endM] = s.endTime.split(':').map(Number);

        const startDateLocal = new Date(`${s.date}T00:00:00Z`); // Using Z just to get a stable base
        const startTimeUtc = new Date(startDateLocal.getTime() + (startH * 60 + startM - tzOffset) * 60 * 1000);
        const endTimeUtc = new Date(startDateLocal.getTime() + (endH * 60 + endM - tzOffset) * 60 * 1000);

        createdSessions.push({
          subjectId: dbSubject.id,
          startTime: startTimeUtc,
          endTime: endTimeUtc,
          focusTopic: s.focusTopic,
        });
      }
    }

    if (createdSessions.length > 0) {
      await prisma.studySession.createMany({
        data: createdSessions
      });
    }

    // 6. Fetch the newly created sessions to return consistent data
    const finalSchedule = await prisma.studySession.findMany({
      where: {
        subject: { userId },
        startTime: { gte: startRangeUtc },
      },
      include: { subject: true },
      orderBy: { startTime: "asc" },
    });

    res.json({
      message: "AI Study Plan generated successfully",
      dailyTotalHours: hoursPerDay,
      schedule: finalSchedule,
    });
  } catch (error) {
    console.error("Groq AI Error:", error);
    res.status(500).json({ message: "Failed to generate AI plan", error: error.message });
  }
};

const chatWithAI = async (req, res) => {
  try {
    const userId = req.userId;
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ message: "Message is required." });
    }

    // 1. Fetch User Data for Context (with safe fallbacks)
    let userName = "Student";
    let userCourse = "Not specified";
    let userSemester = "Not specified";
    let dailyGoal = 4;
    let subjectsContext = "No subjects added yet.";
    let tasksContext = "No pending tasks.";

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, course: true, semester: true, dailyStudyGoal: true }
      });
      if (user) {
        userName = user.name || "Student";
        userCourse = user.course || "Not specified";
        userSemester = user.semester || "Not specified";
        dailyGoal = user.dailyStudyGoal || 4;
      }
    } catch (_) { }

    try {
      const subjects = await prisma.subject.findMany({
        where: { userId },
        include: {
          topics: { where: { isCompleted: false } },
          exams: { orderBy: { date: "asc" }, take: 1 },
        },
      });
      if (subjects && subjects.length > 0) {
        subjectsContext = subjects.map((s) => {
          const topics = s.topics.map((t) => t.name).join(", ");
          const exam = s.exams.length > 0 ? `Next exam: ${s.exams[0].date}` : "No upcoming exams";
          return `- ${s.name}: ${topics} (${exam})`;
        }).join("\n");
      }
    } catch (_) { }

    try {
      const tasks = await prisma.task.findMany({
        where: { userId, isCompleted: false },
        take: 5,
      });
      if (tasks && tasks.length > 0) {
        tasksContext = tasks.map((t) => `- ${t.title}`).join("\n");
      }
    } catch (_) { }

    // 2. Build context prompt
    const contextPrompt = `You are StudyMate AI, a helpful study assistant. 
Current Student: ${userName}
Course: ${userCourse}
Semester: ${userSemester}
Daily Goal: ${dailyGoal} hours

Current Subjects & Pending Topics:
${subjectsContext}

Pending Tasks:
${tasksContext}

Guidelines:
1. Provide concise, encouraging, and actionable study advice.
2. Help the student plan their study sessions based on their specific subjects and tasks.
3. If they ask about their progress, refer to their subjects and topics.
4. Keep the tone friendly and professional.`;

    const messages = [
      { role: "system", content: contextPrompt },
      ...(history || []),
      { role: "user", content: message },
    ];

    // 3. Call Groq
    const completion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 1024,
    });

    const reply = completion.choices[0].message.content;

    res.json({
      reply: reply,
    });
  } catch (error) {
    console.error("Chat AI Error:", error);
    res.status(500).json({ message: "Failed to get AI response", error: error.message });
  }
};

module.exports = { generateAIStudyPlan, chatWithAI };
