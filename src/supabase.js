const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL or Key');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetches a test case by ID.
 * @param {string|number} id - The ID of the test case.
 * @returns {Promise<Object>} - The test case data.
 */
async function fetchTestCase(id) {
    const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        throw new Error(`Error fetching test case: ${error.message}`);
    }

    return data;
}
async function saveTestResults({ 
    user_id, 
    test_case, 
    name, 
    project_id, 
    module_id, 
    status, 
    result, 
    fail_screenShot 
}) {
    try {
        console.log('Saving test results to database...');
        
        // Step 1: Upsert into test_results table
        // This creates or updates the test result based on test_case ID
        const { data, error: upsertError } = await supabase
            .from('test_results')
            .upsert(
                {
                    user_id,
                    test_case,
                    name,
                    status,
                    fail_screenShot
                },
                { onConflict: ['test_case'] } // Update if test_case already exists
            )
            .select();

        if (upsertError) {
            console.error('Upsert error:', upsertError);
            throw upsertError;
        }

        console.log('Test result upserted successfully:', data);

        // Step 2: Insert into run_history table
        // This creates a new history entry for each test run
        if (data && data.length > 0) {
            const { id, name: testName, test_case: testCaseId } = data[0];
            
            const newHistoryEntry = {
                project_id,
                test_case_id: testCaseId,
                test_result_id: id,
                module_id,
                name: testName,
                status,
                fail_screenshot: fail_screenShot,
                result // This contains: { passed, failed, skipped, total, results: [], status: '✅ TEST PASSED', run_by: 'cloud' }
            };

            const { data: runData, error: historyError } = await supabase
                .from('run_history')
                .insert(newHistoryEntry)
                .select();

            if (historyError) {
                console.error('History insert error:', historyError);
                throw historyError;
            }

            console.log('Run history inserted successfully:', runData);
            return runData;
        }

        return data;
    } catch (error) {
        console.error('Failed to save test results:', error);
        throw error;
    }
}

module.exports = {
    supabase,
    fetchTestCase,
    saveTestResults
};

/**
 * Fetches all test cases for given module IDs, ordered by created_at ascending.
 * @param {Array<string|number>} moduleIds
 * @returns {Promise<Array>} - Array of test case objects
 */
async function fetchTestCasesByModuleIds({moduleIds,userId,projectId}) {
    if (!Array.isArray(moduleIds) || moduleIds.length === 0) return [];

    const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .in('module_id', moduleIds)
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`Error fetching test cases by modules: ${error.message}`);
    }

    return data || [];
}

module.exports.fetchTestCasesByModuleIds = fetchTestCasesByModuleIds;
