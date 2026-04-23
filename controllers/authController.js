const prisma = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const signup = async (req, res) => {
    try {
        const { email, password, name, course, semester } = req.body;
        const normalizedEmail = email.toLowerCase().trim();

        const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Bootstrap: Make the first user or specific emails an admin
        const userCount = await prisma.user.count();
        const isFirstUser = userCount === 0;
        const isAdminEmail = normalizedEmail.endsWith('@admin.com') || normalizedEmail === 'admin@studymate.com';
        const role = (isFirstUser || isAdminEmail) ? 'admin' : 'student';

        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                password: hashedPassword,
                name,
                course,
                semester,
                role
            },
        });

        const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: error.message });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email.toLowerCase().trim();
        console.log(`Login attempt for: ${normalizedEmail}`);

        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            console.log(`Login failed: User ${normalizedEmail} not found in DB`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        
        console.log(`User found. Comparing passwords...`);

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log(`Login failed: Password mismatch for ${email}. Password length: ${password.length}`);
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        console.log(`SUCCESS: Login successful for ${email}.`);
        
        // Handle Streak Logic
        const now = new Date();
        let newStreak = user.streak || 0;
        const lastActive = user.lastActive;

        if (!lastActive) {
            newStreak = 1;
        } else {
            const lastActiveDate = new Date(lastActive);
            const diffInDays = Math.floor((now - lastActiveDate) / (1000 * 60 * 60 * 24));
            
            if (diffInDays === 1) {
                newStreak += 1;
            } else if (diffInDays > 1) {
                newStreak = 1;
            }
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { 
                lastActive: now,
                streak: newStreak
            }
        });

        const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, streak: newStreak, dailyStudyGoal: user.dailyStudyGoal } });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { id: true, email: true, name: true, course: true, semester: true, streak: true, dailyStudyGoal: true },
        });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateProfile = async (req, res) => {
    const { name, course, semester, dailyStudyGoal } = req.body;
    try {
        const user = await prisma.user.update({
            where: { id: req.userId },
            data: {
                name,
                course,
                semester,
                dailyStudyGoal: dailyStudyGoal ? parseFloat(dailyStudyGoal) : undefined,
            },
            select: { id: true, name: true, email: true, course: true, semester: true, streak: true, dailyStudyGoal: true },
        });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { signup, login, getProfile, updateProfile };
