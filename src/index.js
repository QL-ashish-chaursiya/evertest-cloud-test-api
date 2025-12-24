const express = require('express');
const cors = require('cors');
const { fetchTestCase, fetchTestCasesByModuleIds } = require('./supabase');
const AutomationService = require('./automation');
const { validateCloudPayload } = require('./utils');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function summarizeResults(results) {
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    return { passed, failed, total: results.length };
}

app.post('/api/run-automation', async (req, res) => {
    const payload = req.body || {};

    // If OTP login is requested but otp payload is missing, set defaults as requested
    if (payload.loginRequired && payload.loginMode === 'otp') {
        if (!payload.otp) {
            payload.otp = {
                storageType: 'localStorage',
                object: '{}'
            };
        }
    }

    const validateRes = validateCloudPayload(payload);
    if (!validateRes.success) {
        return res.status(400).json({ error: validateRes.error });
    }

    // Helper: run a single test case in its own browser (isolated)
    async function runIsolatedTestCase(testCase) {
        const automationService = new AutomationService();
        // Use requested browser/headless from payload (fallback to chromium)
        await automationService.init({ browserName: payload.browser || 'chromium', headless: payload.headless });
        try {
            if (testCase.url) await automationService.navigateTo(testCase.url);
            const results = await automationService.runActions(testCase.actions || []);
            const summary = summarizeResults(results);
            return { testCaseId: testCase.id, status: summary.failed === 0 ? 'passed' : 'failed', summary, results };
        } finally {
            await automationService.close();
        }
    }

    // Helper: run a test case using an existing automationService (keeps session)
    async function runUsingExistingService(automationService, testCase) {
        if (testCase.url) await automationService.navigateTo(testCase.url);
        const results = await automationService.runActionsWithoutClose(testCase.actions || []);
        const summary = summarizeResults(results);
        return { testCaseId: testCase.id, status: summary.failed === 0 ? 'passed' : 'failed', summary, results };
    }

    try {
        // CASE A: single testCaseId present
        if (payload.testCaseId) {
            // Social login required: run auth test in same session, then run main test
            if (payload.loginRequired && payload.loginMode === 'social') {
                const authId = payload.socialAuth && payload.socialAuth.authTestCaseId;
                if (!authId) return res.status(400).json({ error: 'socialAuth.authTestCaseId is required' });

                const automationService = new AutomationService();
                await automationService.init({ browserName: payload.browser || 'chromium', headless: payload.headless });
                try {
                    const authTest = await fetchTestCase(authId);
                    if (!authTest) return res.status(404).json({ error: 'Auth test case not found' });
                    await runUsingExistingService(automationService, authTest);

                    const mainTest = await fetchTestCase(payload.testCaseId);
                    if (!mainTest) return res.status(404).json({ error: 'Test case not found' });
                    const mainReport = await runUsingExistingService(automationService, mainTest);

                    return res.json({ authTestId: authTest.id, main: mainReport });
                } finally {
                    await automationService.close();
                }
            }

            // OTP login required: ensure otp set (we set defaults above), then run single test in isolated browser
            if (payload.loginRequired && payload.loginMode === 'otp') {
                const testCase = await fetchTestCase(payload.testCaseId);
                if (!testCase) return res.status(404).json({ error: 'Test case not found' });

                const report = await runIsolatedTestCase(testCase);
                return res.json(report);
            }

            // No login required: just fetch and run the single test case isolated
            const testCase = await fetchTestCase(payload.testCaseId);
            if (!testCase) return res.status(404).json({ error: 'Test case not found' });
            const report = await runIsolatedTestCase(testCase);
            return res.json(report);
        }

        // CASE B: no testCaseId, moduleIds present -> run all test cases within these modules
        if (Array.isArray(payload.moduleIds) && payload.moduleIds.length > 0) {
            // Fetch test cases for these modules ordered by created_at (ascending)
            const testCases = await fetchTestCasesByModuleIds(payload);

            if (!payload.loginRequired) {
                // Run each test case in isolation (new browser per test case)
                const reports = [];
                for (const tc of testCases) {
                    const r = await runIsolatedTestCase(tc);
                    reports.push(r);
                }
                // overall summary across tests
                const overall = reports.reduce((acc, r) => {
                    acc.passed += r.summary.passed;
                    acc.failed += r.summary.failed;
                    acc.tests += 1;
                    acc.actions += r.summary.total;
                    return acc;
                }, { passed: 0, failed: 0, tests: 0, actions: 0 });

                return res.json({ moduleIds: payload.moduleIds, count: reports.length, overall, reports });
            }

            // loginRequired + social: run auth first in one session, then run all testcases in same session sequentially
            if (payload.loginMode === 'social') {
                const authId = payload.socialAuth && payload.socialAuth.authTestCaseId;
                if (!authId) return res.status(400).json({ error: 'socialAuth.authTestCaseId is required' });

                const automationService = new AutomationService();
                await automationService.init({ browserName: payload.browser || 'chromium', headless: payload.headless });
                try {
                    const authTest = await fetchTestCase(authId);
                    if (!authTest) return res.status(404).json({ error: 'Auth test case not found' });
                    await runUsingExistingService(automationService, authTest);

                    const reports = [];
                    for (const tc of testCases) {
                        const r = await runUsingExistingService(automationService, tc);
                        reports.push(r);
                    }

                    const overall = reports.reduce((acc, r) => {
                        acc.passed += r.summary.passed;
                        acc.failed += r.summary.failed;
                        acc.tests += 1;
                        acc.actions += r.summary.total;
                        return acc;
                    }, { passed: 0, failed: 0, tests: 0, actions: 0 });

                    return res.json({ authTestId: authTest.id, moduleIds: payload.moduleIds, count: reports.length, overall, reports });
                } finally {
                    await automationService.close();
                }
            }

            // loginRequired + otp: ensure otp defaults set and run all tests (isolated per test) as requested
            if (payload.loginMode === 'otp') {
                // payload.otp was already defaulted above
                const reports = [];
                for (const tc of testCases) {
                    const r = await runIsolatedTestCase(tc);
                    reports.push(r);
                }
                const overall = reports.reduce((acc, r) => {
                    acc.passed += r.summary.passed;
                    acc.failed += r.summary.failed;
                    acc.tests += 1;
                    acc.actions += r.summary.total;
                    return acc;
                }, { passed: 0, failed: 0, tests: 0, actions: 0 });

                return res.json({ moduleIds: payload.moduleIds, count: reports.length, overall, reports });
            }
        }

        return res.status(400).json({ error: 'Invalid payload: provide testCaseId or moduleIds' });

    } catch (error) {
        console.error('Error running automation:', error);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
