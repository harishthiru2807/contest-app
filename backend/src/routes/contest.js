const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { findOne, find, insert, update } = require('../db');
const { evaluateWithTestCases } = require('../utils/codeRunner');

async function getSettings() {
    let s = await findOne('settings', { singleton: 'main' });
    if (!s) {
        s = { singleton: 'main', isActive: false, scheduledStart: null, contestDuration: 60, announcements: [], startedAt: null, stoppedAt: null };
        await insert('settings', s);
    }
    return s;
}

// GET /api/contest/status
router.get('/status', async (req, res) => {
    try {
        const s = await getSettings();
        res.json({ isActive: s.isActive, scheduledStart: s.scheduledStart, contestDuration: s.contestDuration, startedAt: s.startedAt, announcements: (s.announcements || []).slice(-5) });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/contest/me
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const team = await findOne('teams', { teamID: req.team.teamID });
        if (!team) return res.status(404).json({ message: 'Team not found' });
        const { sessionToken, deviceFingerprint, _id, ...safe } = team;
        res.json({ team: safe });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/contest/questions
router.get('/questions', authMiddleware, async (req, res) => {
    try {
        const settings = await getSettings();
        if (!settings.isActive) return res.status(403).json({ message: 'Contest has not started yet' });
        const questions = await find('questions', {}, { section: 1, order: 1 });
        const sanitized = questions.map(q => ({
            questionID: q.questionID, type: q.type, section: q.section, order: q.order,
            questionText: q.questionText, options: q.options || [], marks: q.marks,
            starterCode: q.starterCode || '', testCasesCount: (q.testCases || []).length
        }));
        res.json({ questions: sanitized });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// GET /api/contest/drafts
router.get('/drafts', authMiddleware, async (req, res) => {
    try {
        const subs = await find('submissions', { teamID: req.team.teamID });
        const drafts = {};
        subs.forEach(s => { drafts[s.questionID] = { code: s.code, selectedOption: s.selectedOption, output: s.output, marks: s.marks, evaluated: s.evaluated }; });
        res.json({ drafts });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

// POST /api/contest/save-draft
router.post('/save-draft', authMiddleware, async (req, res) => {
    try {
        const { questionID, code, selectedOption } = req.body;
        const team = await findOne('teams', { teamID: req.team.teamID });
        if (!team || team.submitted) return res.status(400).json({ message: 'Already submitted' });
        const question = await findOne('questions', { questionID });
        if (!question) return res.status(404).json({ message: 'Question not found' });

        const existing = await findOne('submissions', { teamID: req.team.teamID, questionID });
        if (existing) {
            await update('submissions', { teamID: req.team.teamID, questionID }, { $set: { code: code || '', selectedOption: selectedOption || '', updatedAt: new Date().toISOString() } });
        } else {
            await insert('submissions', { teamID: req.team.teamID, questionID, type: question.type, code: code || '', selectedOption: selectedOption || '', output: '', marks: 0, maxMarks: question.marks, testResults: [], evaluated: false, createdAt: new Date().toISOString() });
        }
        res.json({ message: 'Draft saved' });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/contest/submit
router.post('/submit', authMiddleware, async (req, res) => {
    try {
        const team = await findOne('teams', { teamID: req.team.teamID });
        if (!team) return res.status(404).json({ message: 'Team not found' });
        if (team.submitted) {
            const subs = await find('submissions', { teamID: req.team.teamID });
            const total = subs.reduce((a, s) => a + (s.marks || 0), 0);
            return res.json({ message: 'Already submitted', score: total });
        }

        const questions = await find('questions', {});
        const submissions = await find('submissions', { teamID: req.team.teamID });
        let totalScore = 0;

        for (const question of questions) {
            let sub = submissions.find(s => s.questionID === question.questionID);
            let marks = 0, output = '', testResults = [];

            if (question.type === 'mcq') {
                const selected = sub?.selectedOption || '';
                if (selected !== '' && selected === question.correctAnswer) marks = question.marks;
                output = selected;
            } else if (sub?.code?.trim()) {
                const tcs = question.testCases || [];
                if (tcs.length > 0) {
                    const evalResult = await evaluateWithTestCases(sub.code, tcs, question.marks);
                    marks = evalResult.marksEarned;
                    output = evalResult.results.map(r => `TC: ${r.passed ? 'PASS' : 'FAIL'}`).join('\n');
                    testResults = evalResult.results;
                }
            }
            totalScore += marks;

            if (sub) {
                await update('submissions', { teamID: req.team.teamID, questionID: question.questionID }, { $set: { marks, output, testResults, evaluated: true } });
            } else {
                await insert('submissions', { teamID: req.team.teamID, questionID: question.questionID, type: question.type, code: '', selectedOption: '', output, marks, maxMarks: question.marks, testResults, evaluated: true, createdAt: new Date().toISOString() });
            }
        }

        await update('teams', { teamID: req.team.teamID }, { $set: { score: totalScore, submitted: true, endTime: new Date().toISOString() } });
        const io = req.app.get('io');
        io.emit('score_update', { teamID: req.team.teamID, score: totalScore });
        res.json({ message: 'Submitted successfully', score: totalScore });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Server error during submission' }); }
});

// POST /api/contest/violation
router.post('/violation', authMiddleware, async (req, res) => {
    try {
        const { type } = req.body;
        const team = await findOne('teams', { teamID: req.team.teamID });
        if (!team || team.submitted) return res.json({ message: 'Already resolved' });

        const newViolations = (team.violations || 0) + 1;
        if (newViolations >= 2) {
            const reason = `Auto-disqualified: ${type || 'violation'} (2nd offense)`;
            await update('teams', { teamID: req.team.teamID }, { $set: { violations: newViolations, disqualified: true, disqualifiedReason: reason, submitted: true, endTime: new Date().toISOString() } });
            const io = req.app.get('io');
            io.to(`team_${req.team.teamID}`).emit('disqualified', { reason });
            return res.json({ violations: newViolations, disqualified: true, message: 'Disqualified' });
        }
        await update('teams', { teamID: req.team.teamID }, { $set: { violations: newViolations } });
        res.json({ violations: newViolations, disqualified: false, message: 'Warning issued' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
