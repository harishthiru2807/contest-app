const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const COMPILE_TIMEOUT = 10000; // 10s
const RUN_TIMEOUT = 5000;      // 5s per test case
const MAX_OUTPUT_SIZE = 10000; // 10KB

async function runCCode(code, input = '') {
    const id = uuidv4();
    const tmpDir = os.tmpdir();
    const srcFile = path.join(tmpDir, `prog_${id}.c`);
    const exeFile = path.join(tmpDir, `prog_${id}`); // Removed .exe for Linux

    try {
        fs.writeFileSync(srcFile, code, 'utf8');

        // Compile
        await new Promise((resolve, reject) => {
            exec(`gcc "${srcFile}" -o "${exeFile}" -lm`, { timeout: COMPILE_TIMEOUT }, (err, stdout, stderr) => {
                if (err) {
                    console.error('Compilation Error:', stderr || err.message);
                    reject({ type: 'compile', message: stderr || err.message });
                } else resolve();
            });
        });

        // Run
        const output = await new Promise((resolve, reject) => {
            // Use explicit path for Linux execution
            const proc = exec(`"${exeFile}"`, { timeout: RUN_TIMEOUT }, (err, stdout, stderr) => {
                if (err) {
                    if (err.killed) reject({ type: 'timeout', message: 'Execution timed out (5s limit)' });
                    else {
                        console.error('Runtime Error:', stderr || err.message);
                        reject({ type: 'runtime', message: stderr || err.message });
                    }
                } else resolve((stdout || '').slice(0, MAX_OUTPUT_SIZE));
            });

            if (input) {
                proc.stdin.write(input);
                proc.stdin.end();
            }
        });

        return { success: true, output: output.trim() };
    } catch (err) {
        return { success: false, error: err.message || 'Unknown error', type: err.type || 'error', output: '' };
    } finally {
        // Cleanup temp files
        try { fs.unlinkSync(srcFile); } catch (_) { }
        try { fs.unlinkSync(exeFile); } catch (_) { }
    }
}

async function evaluateWithTestCases(code, testCases, totalMarks) {
    const results = [];
    let passedCount = 0;

    for (const tc of testCases) {
        const result = await runCCode(code, tc.input || '');
        const passed = result.success && normalizeOutput(result.output) === normalizeOutput(tc.expectedOutput);
        results.push({
            input: tc.input,
            expected: tc.expectedOutput,
            got: result.output,
            passed,
            error: result.error || null
        });
        if (passed) passedCount++;
    }

    const marksEarned = Math.round((passedCount / testCases.length) * totalMarks);
    return { results, passedCount, totalCases: testCases.length, marksEarned };
}

function normalizeOutput(str) {
    return (str || '').trim().replace(/\r\n/g, '\n').replace(/\s+$/gm, '');
}

module.exports = { runCCode, evaluateWithTestCases };
