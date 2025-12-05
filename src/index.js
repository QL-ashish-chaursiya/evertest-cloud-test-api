const express = require('express');
const cors = require('cors');
const { fetchTestCase } = require('./supabase');
const AutomationService = require('./automation');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/api/run-automation', async (req, res) => {
    const { testCaseId } = req.body;

    if (!testCaseId) {
        return res.status(400).json({ error: 'testCaseId is required' });
    }

    console.log(`Received request to run automation for test case ID: ${testCaseId}`);

    let automationService;

    try {
        // Fetch test case from Supabase
        const testCase = await fetchTestCase(testCaseId);

        if (!testCase) {
            return res.status(404).json({ error: 'Test case not found' });
        }

        console.log(`Fetched test case: ${testCase.id}`);

        // Initialize automation service
        automationService = new AutomationService();
        await automationService.init();

        // Open the URL from test case before running actions
        if (testCase.url) {
            console.log(`Opening URL: ${testCase.url}`);
            await automationService.navigateTo(testCase.url);
            console.log('URL opened successfully');
        } else {
            console.warn('No URL found in test case');
        }

        // Run actions
        // Assuming 'actions' is the column name in Supabase containing the steps
        // and it's an array of action objects.
        const actions = testCase.actions;

        if (!actions || !Array.isArray(actions)) {
            throw new Error('Invalid test case format: actions missing or not an array');
        }

        const results = await automationService.runActions(actions);

        // Calculate summary
        const passed = results.filter(r => r.status === 'pass').length;
        const failed = results.filter(r => r.status === 'fail').length;

        const report = {
            testCaseId,
            status: failed === 0 ? 'passed' : 'failed',
            passed,
            failed,
            total: results.length,
            results
        };

        res.json(report);

    } catch (error) {
        console.error('Error running automation:', error);
        res.status(500).json({ error: error.message });
    } finally {
        // Ensure browser is closed if it wasn't already
        if (automationService) {
            // It might have been closed in runActions, but safe to call again or check state
            // The service.close() handles null checks
            // We rely on runActions finally block usually, but good to be safe if error happened before runActions
        }
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
