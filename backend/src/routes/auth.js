const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { findOne, insert, update } = require('../db');

function getFingerprint(req) {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

// POST /api/auth/admin
router.post('/admin', (req, res) => {
    try {
        const { email, password } = req.body;
        if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }
        const token = jwt.sign({ email, isAdmin: true }, process.env.ADMIN_JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, message: 'Admin login successful' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { teamName, leaderName, email } = req.body;
        if (!teamName || !leaderName || !email) return res.status(400).json({ message: 'All fields are required' });
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) return res.status(400).json({ message: 'Invalid email format' });

        const sanitizedEmail = email.toLowerCase().trim();
        const fingerprint = getFingerprint(req);

        let team = await findOne('teams', { email: sanitizedEmail });

        if (team) {
            if (team.deviceFingerprint && team.deviceFingerprint !== fingerprint) {
                return res.status(403).json({ message: 'This email is already logged in from another device.' });
            }
            const token = jwt.sign({ teamID: team.teamID, email: team.email, teamName: team.teamName }, process.env.JWT_SECRET, { expiresIn: '4h' });
            await update('teams', { email: sanitizedEmail }, { $set: { deviceFingerprint: fingerprint, sessionToken: token } });
            return res.json({ token, team: { teamID: team.teamID, teamName: team.teamName, leaderName: team.leaderName, email: team.email, submitted: team.submitted, disqualified: team.disqualified } });
        }

        const existingEmail = await findOne('teams', { email: sanitizedEmail });
        if (existingEmail) return res.status(409).json({ message: 'Email already registered' });

        const teamID = 'TEAM-' + uuidv4().slice(0, 8).toUpperCase();
        const newTeam = { teamName: teamName.trim(), leaderName: leaderName.trim(), email: sanitizedEmail, teamID, score: 0, disqualified: false, disqualifiedReason: '', violations: 0, startTime: new Date().toISOString(), endTime: null, submitted: false, deviceFingerprint: fingerprint, sessionToken: '', createdAt: new Date().toISOString() };
        await insert('teams', newTeam);

        const token = jwt.sign({ teamID, email: sanitizedEmail, teamName: teamName.trim() }, process.env.JWT_SECRET, { expiresIn: '4h' });
        await update('teams', { teamID }, { $set: { sessionToken: token } });

        res.status(201).json({ token, team: { teamID, teamName: teamName.trim(), leaderName: leaderName.trim(), email: sanitizedEmail, submitted: false, disqualified: false } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
