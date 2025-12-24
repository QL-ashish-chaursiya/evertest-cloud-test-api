 const express = require('express');
const cors = require('cors');
const { fetchTestCase, fetchTestCasesByModuleIds, saveTestResults } = require('./supabase');
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
    const skipped = 0;
    return { passed, failed, skipped, total: results.length };
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

    const { testCaseId, moduleIds, loginRequired, loginMode, socialAuth, otp, browserName, userId, projectId } = payload;

    console.log('Received automation request:', { testCaseId, moduleIds, loginRequired, loginMode });

    let automationService;
    const allResults = [];

    try {
        // Initialize automation service ONCE
        automationService = new AutomationService();
        await automationService.init({ browserName: browserName || 'chromium', headless: payload.headless });

        let loginSession = null;

        // Handle login if required
        if (loginRequired) {
            if (loginMode === 'social' && socialAuth?.authTestCaseId) {
                console.log('Running auth test case first...');
                const authTest = await fetchTestCase(socialAuth.authTestCaseId);
                if (!authTest) {
                    return res.status(404).json({ error: 'Auth test case not found' });
                }

                // Run auth test (don't save results for auth test)
                if (authTest.url) await automationService.navigateTo(authTest.url);
                await automationService.runActionsStopOnFailure(authTest.actions || []);
                
                console.log('Auth test completed, session established');
            } else if (loginMode === 'otp' && otp) {
                console.log('Setting OTP storage...');
                await automationService.setOtpStorage(otp);
            }
        }

        let testCasesToRun = [];

        // CASE A: Single test case execution
        if (testCaseId) {
            console.log(`Running single test case: ${testCaseId}`);
            
            const testCase = await fetchTestCase(testCaseId);
            if (!testCase) {
                return res.status(404).json({ error: 'Test case not found' });
            }

            testCasesToRun = [testCase];
        }
        // CASE B: Multiple test cases from modules
        else if (Array.isArray(moduleIds) && moduleIds.length > 0) {
            console.log(`Running test cases from modules: ${moduleIds.join(', ')}`);
            
            // Fetch all test cases from modules, sorted by created_at
            const testCases = await fetchTestCasesByModuleIds(payload);
            
            if (!testCases || testCases.length === 0) {
                return res.status(404).json({ error: 'No test cases found in specified modules' });
            }

            // Filter out auth test case if it exists in the list
            const authTestCaseId = socialAuth?.authTestCaseId;
            testCasesToRun = testCases.filter(tc => tc.id !== authTestCaseId);

            console.log(`Found ${testCasesToRun.length} test cases to run (excluding auth test case)`);
        } else {
            return res.status(400).json({ error: 'Either testCaseId or moduleIds must be provided' });
        }

        // Run all test cases sequentially in the SAME browser session
        for (const testCase of testCasesToRun) {
            try {
                console.log(`Running test case: ${testCase.id} - ${testCase.name}`);

                // Navigate to test case URL
                if (testCase.url) {
                    await automationService.navigateTo(testCase.url);
                }

                // Run actions with stop on failure
                const results = await automationService.runActionsStopOnFailure(testCase.actions || []);
                
                // Calculate summary
                const summary = summarizeResults(results);
                const status = summary.failed > 0 ? 'fail' : 'pass';

                // Capture screenshot if failed
                let failScreenshot = null;
                if (status === 'fail') {
                    try {
                        failScreenshot = await automationService.captureScreenshot();
                    } catch (error) {
                        console.error('Error capturing screenshot:', error);
                    }
                }

                const testResult = {
                    testCaseId: testCase.id,
                    testCaseName: testCase.name,
                    status,
                    ...summary,
                    results
                };

                allResults.push(testResult);

                // Save to database
                try {
                    await saveTestResults({
                        user_id: userId,
                        test_case: testCase.id,
                        name: testCase.name,
                        project_id: projectId,
                        module_id: testCase.module_id,
                        status,
                        result: {
                            passed: summary.passed,
                            failed: summary.failed,
                            skipped: summary.skipped,
                            total: summary.total,
                            results: results,
                            status: status === 'pass' ? '✅ TEST PASSED' : '❌ TEST FAILED',
                            run_by: 'cloud'
                        },
                        fail_screenShot: failScreenshot
                    });

                    console.log(`✅ Test case ${testCase.id} saved to database`);
                } catch (dbError) {
                    console.error('❌ Error saving to database:', dbError);
                }

            } catch (error) {
                console.error(`❌ Error running test case ${testCase.id}:`, error);
                
                const errorResult = {
                    testCaseId: testCase.id,
                    testCaseName: testCase.name,
                    status: 'fail',
                    passed: 0,
                    failed: 1,
                    skipped: 0,
                    total: 1,
                    results: [{
                        sequence: 1,
                        description: 'Test execution error',
                        status: 'fail',
                        message: error.message,
                        assertions: []
                    }]
                };
                
                allResults.push(errorResult);

                // Save error result to database
                try {
                    await saveTestResults({
                        user_id: userId,
                        test_case: testCase.id,
                        name: testCase.name,
                        project_id: projectId,
                        module_id: testCase.module_id,
                        status: 'fail',
                        result: {
                            passed: 0,
                            failed: 1,
                            skipped: 0,
                            total: 1,
                            results: errorResult.results,
                            status: '❌ TEST FAILED',
                            run_by: 'cloud'
                        },
                        fail_screenShot: null
                    });
                } catch (dbError) {
                    console.error('Error saving failed test to database:', dbError);
                }
            }
        }

        // Calculate overall summary
        const totalPassed = allResults.reduce((sum, r) => sum + (r.passed || 0), 0);
        const totalFailed = allResults.reduce((sum, r) => sum + (r.failed || 0), 0);
        const overallStatus = totalFailed === 0 ? 'passed' : 'failed';

        const report = {
            status: overallStatus,
            totalTestCases: allResults.length,
            passed: totalPassed,
            failed: totalFailed,
            testCases: allResults
        };

        res.json(report);

    } catch (error) {
        console.error('Error running automation:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        // Ensure browser is closed ONCE at the end
        if (automationService) {
            try {
                await automationService.close();
                console.log('Browser closed successfully');
            } catch (error) {
                console.error('Error closing browser:', error);
            }
        }
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});