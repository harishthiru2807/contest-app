const express = require('express');
const router = express.Router();
const adminMiddleware = require('../middleware/adminMiddleware');
const { findOne, find, insert, update, count } = require('../db');
const XLSX = require('xlsx');

async function getSettings() {
    let s = await findOne('settings', { singleton: 'main' });
    if (!s) { s = { singleton: 'main', isActive: false, scheduledStart: null, contestDuration: 60, announcements: [], startedAt: null, stoppedAt: null }; await insert('settings', s); }
    return s;
}

// GET /api/admin/teams
router.get('/teams', adminMiddleware, async (req, res) => {
    try {
        const { search, disqualified } = req.query;
        let query = {};
        if (disqualified !== undefined) query.disqualified = disqualified === 'true';
        let teams = await find('teams', query, { score: -1 });
        if (search) {
            const s = search.toLowerCase();
            teams = teams.filter(t => t.teamName?.toLowerCase().includes(s) || t.email?.toLowerCase().includes(s) || t.leaderName?.toLowerCase().includes(s));
        }
        res.json({ teams: teams.map(({ _id, sessionToken, deviceFingerprint, ...t }) => t) });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/admin/leaderboard
router.get('/leaderboard', adminMiddleware, async (req, res) => {
    try {
        const teams = await find('teams', { submitted: true }, { score: -1 });
        const lb = teams.map((t, i) => ({ rank: i + 1, teamName: t.teamName, leaderName: t.leaderName, email: t.email, teamID: t.teamID, score: t.score, disqualified: t.disqualified, endTime: t.endTime }));
        res.json({ leaderboard: lb });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/admin/team/:teamID/submissions
router.get('/team/:teamID/submissions', adminMiddleware, async (req, res) => {
    try {
        const team = await findOne('teams', { teamID: req.params.teamID });
        if (!team) return res.status(404).json({ message: 'Team not found' });
        const submissions = await find('submissions', { teamID: req.params.teamID }, { questionID: 1 });
        const questions = await find('questions', {}, { section: 1, order: 1 });
        const { _id, sessionToken, deviceFingerprint, ...safeTeam } = team;
        res.json({ team: safeTeam, submissions: submissions.map(({ _id, ...s }) => s), questions: questions.map(({ _id, ...q }) => q) });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/admin/export
router.get('/export', adminMiddleware, async (req, res) => {
    try {
        const teams = await find('teams', {}, { score: -1 });
        const data = teams.map((t, i) => ({
            Rank: i + 1, 'Team Name': t.teamName, 'Leader Name': t.leaderName, Email: t.email,
            'Team ID': t.teamID, Score: t.score, 'Submit Status': t.submitted ? 'Submitted' : 'Not Submitted',
            Disqualified: t.disqualified ? 'Yes' : 'No', 'Disqualification Reason': t.disqualifiedReason || '',
            Violations: t.violations || 0, 'End Time': t.endTime ? new Date(t.endTime).toLocaleString() : ''
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Results');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="contest_results.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// POST /api/admin/contest/start
router.post('/contest/start', adminMiddleware, async (req, res) => {
    try {
        const { scheduledStart, duration } = req.body;
        const settings = await getSettings();
        const upd = { isActive: true, startedAt: scheduledStart ? new Date(scheduledStart).toISOString() : new Date().toISOString(), scheduledStart: scheduledStart || null, stoppedAt: null };
        if (duration) upd.contestDuration = Number(duration);
        await update('settings', { singleton: 'main' }, { $set: upd });
        const io = req.app.get('io');
        io.emit('contest_started', { startedAt: upd.startedAt, duration: upd.contestDuration || settings.contestDuration });
        res.json({ message: 'Contest started' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// POST /api/admin/contest/stop
router.post('/contest/stop', adminMiddleware, async (req, res) => {
    try {
        await update('settings', { singleton: 'main' }, { $set: { isActive: false, stoppedAt: new Date().toISOString() } });
        const io = req.app.get('io');
        io.emit('contest_stopped', { stoppedAt: new Date().toISOString() });
        res.json({ message: 'Contest stopped' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// POST /api/admin/announce
router.post('/announce', adminMiddleware, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message?.trim()) return res.status(400).json({ message: 'Announcement cannot be empty' });
        const settings = await getSettings();
        const ann = { message: message.trim(), createdAt: new Date().toISOString() };
        const announcements = [...(settings.announcements || []), ann].slice(-50);
        await update('settings', { singleton: 'main' }, { $set: { announcements } });
        const io = req.app.get('io');
        io.emit('announcement', ann);
        res.json({ message: 'Announcement sent', announcement: ann });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// POST /api/admin/disqualify/:teamID
router.post('/disqualify/:teamID', adminMiddleware, async (req, res) => {
    try {
        const team = await findOne('teams', { teamID: req.params.teamID });
        if (!team) return res.status(404).json({ message: 'Team not found' });
        await update('teams', { teamID: req.params.teamID }, { $set: { disqualified: true, disqualifiedReason: req.body.reason || 'Manual disqualification' } });
        res.json({ message: 'Team disqualified' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/admin/stats
router.get('/stats', adminMiddleware, async (req, res) => {
    try {
        const total = await count('teams', {});
        const submitted = await count('teams', { submitted: true });
        const disqualified = await count('teams', { disqualified: true });
        const settings = await getSettings();
        res.json({ total, submitted, disqualified, isActive: settings.isActive, startedAt: settings.startedAt, duration: settings.contestDuration });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
