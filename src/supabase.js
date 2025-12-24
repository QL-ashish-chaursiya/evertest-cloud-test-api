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

module.exports = {
    supabase,
    fetchTestCase
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
