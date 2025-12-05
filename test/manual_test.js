const AutomationService = require('../src/automation');

async function runTest() {
    const service = new AutomationService();
    await service.init();

    const actions = [
        { type: 'navigate', url: 'https://example.com' },
        { type: 'wait', duration: 2000 },
        // Example.com doesn't have inputs, so we just navigate and wait.
        // Let's try a google search if network allows, or just stick to example.com
        // to be safe and fast.
    ];

    console.log('Starting manual test...');
    const results = await service.runActions(actions);
    console.log('Test Results:', JSON.stringify(results, null, 2));
}

runTest();
